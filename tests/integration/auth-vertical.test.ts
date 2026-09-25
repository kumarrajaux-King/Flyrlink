/**
 * The authentication vertical slice, end to end through the real routes.
 *
 * Phase 4 already covers registration shape, the login cookie, session reads,
 * logout and the 401/403 envelope (`auth-routes.test.ts`, `auth.test.ts`).
 * This file covers what that left open, and what the slice adds:
 *
 *   - privileged roles cannot be self-registered
 *   - email normalisation, and the duplicate it therefore catches
 *   - a weak password
 *   - an account that is unverified, or suspended after signing in
 *   - lockout after repeated failures
 *   - a session that has expired, and one that was revoked
 *   - audit records for the security-sensitive moments
 *   - the role → dashboard gate, per role
 *
 * Skips cleanly when no database is reachable.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import { authorize } from '../../lib/authz/authorize';
import { DASHBOARDS, landingPath } from '../../lib/authz/dashboards';
import { type RoleName, permissionsForRoles } from '../../lib/authz/roles';
import { prisma } from '../../lib/db/client';
import { SESSION_COOKIE_NAME } from '../../lib/http/session-cookie';
import { POST as loginRoute } from '../../app/api/auth/login/route';
import { POST as logoutRoute } from '../../app/api/auth/logout/route';
import { POST as registerRoute } from '../../app/api/auth/register/route';
import { GET as sessionRoute } from '../../app/api/auth/session/route';
import { GET as projectsRoute } from '../../app/api/projects/route';
import { MAX_FAILED_LOGIN_ATTEMPTS } from '../../services/auth/login-service';
import { resolveSession } from '../../services/auth/session-service';
import { isDatabaseAvailable } from '../support/lifecycle-fixtures';

const available = await isDatabaseAvailable();
const BASE = 'http://localhost:3000';
const STAMP = Date.now().toString(36);
const PASSWORD = 'VerticalSlice!9xyz';

const users: string[] = [];

afterAll(async () => {
  if (!available) return;
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.session.deleteMany({ where: { userId: { in: users } } });
  await prisma.customerProfile.deleteMany({ where: { userId: { in: users } } });
  await prisma.expertProfile.deleteMany({ where: { userId: { in: users } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: users } } });
  await prisma.verificationToken.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

interface Reply {
  readonly status: number;
  readonly data: Record<string, unknown> | undefined;
  readonly error: { readonly code: string } | undefined;
  readonly cookie: string | undefined;
  readonly setCookie: string | null;
}

async function call(
  handler: (request: Request) => Promise<Response>,
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
): Promise<Reply> {
  const headers = new Headers({ 'content-type': 'application/json', 'x-request-id': `auth-${randomUUID()}` });
  if (options.cookie) headers.set('cookie', options.cookie);
  const response = await handler(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  );
  // 204 carries no body, which is correct for logout; parsing it would throw.
  const text = await response.text();
  let json: { data?: Record<string, unknown>; error?: { code: string } } = {};
  try {
    json = text ? (JSON.parse(text) as typeof json) : {};
  } catch {
    json = {};
  }
  const setCookie = response.headers.get('set-cookie');
  return {
    status: response.status,
    data: json.data,
    error: json.error,
    cookie: setCookie ? setCookie.split(';')[0] : undefined,
    setCookie,
  };
}

/** Register, activate and sign in. Returns the session cookie. */
async function account(
  label: string,
  accountType: 'CUSTOMER' | 'EXPERT' = 'CUSTOMER',
): Promise<{ userId: string; email: string; cookie: string }> {
  const email = `vertical-${label}-${STAMP}@example.test`;
  await call(registerRoute, 'POST', '/api/auth/register', {
    body: { email, password: PASSWORD, fullName: `Vertical ${label}`, accountType, acceptedTerms: true },
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  users.push(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', emailVerified: new Date() } });

  const signedIn = await call(loginRoute, 'POST', '/api/auth/login', { body: { email, password: PASSWORD } });
  return { userId: user.id, email, cookie: signedIn.cookie ?? '' };
}

describe.skipIf(!available)('registration: privileged roles cannot be self-assigned', () => {
  it('rejects every privileged account type at the boundary', async () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN', 'FINANCE', 'SUPPORT', 'VERIFICATION_MANAGER']) {
      const email = `escalate-${role}-${STAMP}@example.test`;
      const result = await call(registerRoute, 'POST', '/api/auth/register', {
        body: { email, password: PASSWORD, fullName: 'Escalation Attempt', accountType: role, acceptedTerms: true },
      });
      expect(result, role).toMatchObject({ status: 422, error: { code: 'VALIDATION_FAILED' } });
      // And nothing was created: a refusal that still wrote a row would be worse.
      expect(await prisma.user.count({ where: { email } }), role).toBe(0);
    }
  });

  it('ignores a roles array smuggled into the body', async () => {
    const email = `smuggle-${STAMP}@example.test`;
    const result = await call(registerRoute, 'POST', '/api/auth/register', {
      body: {
        email,
        password: PASSWORD,
        fullName: 'Smuggler',
        accountType: 'CUSTOMER',
        acceptedTerms: true,
        roles: ['ADMIN'],
      },
    });
    // strictObject: an unknown field is a refusal, not silently dropped input.
    expect(result).toMatchObject({ status: 422, error: { code: 'VALIDATION_FAILED' } });
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('grants a self-registered account exactly the role it asked for', async () => {
    const customer = await account('role-customer', 'CUSTOMER');
    const roles = await prisma.userRole.findMany({
      where: { userId: customer.userId, revokedAt: null },
      select: { role: { select: { name: true } } },
    });
    expect(roles.map((link) => link.role.name)).toEqual(['CUSTOMER']);
  });
});

describe.skipIf(!available)('registration: validation', () => {
  it('rejects a malformed email', async () => {
    const result = await call(registerRoute, 'POST', '/api/auth/register', {
      body: { email: 'not-an-email', password: PASSWORD, fullName: 'Bad Email', accountType: 'CUSTOMER', acceptedTerms: true },
    });
    expect(result).toMatchObject({ status: 422, error: { code: 'VALIDATION_FAILED' } });
  });

  it('rejects a password below the policy length', async () => {
    const result = await call(registerRoute, 'POST', '/api/auth/register', {
      body: { email: `weak-${STAMP}@example.test`, password: 'short1!', fullName: 'Weak Password', accountType: 'CUSTOMER', acceptedTerms: true },
    });
    expect(result).toMatchObject({ status: 422, error: { code: 'VALIDATION_FAILED' } });
    expect(await prisma.user.count({ where: { email: `weak-${STAMP}@example.test` } })).toBe(0);
  });

  it('rejects a registration that does not accept the terms', async () => {
    const result = await call(registerRoute, 'POST', '/api/auth/register', {
      body: { email: `terms-${STAMP}@example.test`, password: PASSWORD, fullName: 'No Terms', accountType: 'CUSTOMER', acceptedTerms: false },
    });
    expect(result).toMatchObject({ status: 422 });
  });

  it('normalises the email, so a different casing is the same account', async () => {
    const email = `Normalise-${STAMP}@Example.TEST`;
    await call(registerRoute, 'POST', '/api/auth/register', {
      body: { email, password: PASSWORD, fullName: 'Case Test', accountType: 'CUSTOMER', acceptedTerms: true },
    });
    const stored = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
    expect(stored).not.toBeNull();
    users.push(stored!.id);

    // A second registration with different casing and spacing is the duplicate
    // path, and is answered identically rather than as an error.
    const again = await call(registerRoute, 'POST', '/api/auth/register', {
      body: { email: `  ${email.toUpperCase()}  `, password: PASSWORD, fullName: 'Case Test 2', accountType: 'CUSTOMER', acceptedTerms: true },
    });
    expect(again.status).toBe(202);
    expect(await prisma.user.count({ where: { email: email.toLowerCase() } })).toBe(1);
  });

  it('writes an audit record for a registration', async () => {
    const created = await account('audit-register');
    // Audited against the user, with no actor: nobody is authenticated at the
    // moment of registration, so claiming one would be false.
    const audit = await prisma.auditLog.findMany({
      where: { entityId: created.userId, action: AUDIT_ACTIONS.USER_REGISTERED },
      select: { actorUserId: true, entityType: true },
    });
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0]).toMatchObject({ actorUserId: null, entityType: 'User' });
  });
});

describe.skipIf(!available)('sign-in', () => {
  it('sets an httpOnly, SameSite=Lax cookie and never echoes the password', async () => {
    const created = await account('cookie');
    const signedIn = await call(loginRoute, 'POST', '/api/auth/login', {
      body: { email: created.email, password: PASSWORD },
    });

    expect(signedIn.status).toBe(200);
    expect(signedIn.setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(signedIn.setCookie?.toLowerCase()).toContain('httponly');
    expect(signedIn.setCookie?.toLowerCase()).toContain('samesite=lax');
    expect(JSON.stringify(signedIn.data)).not.toContain(PASSWORD);
  });

  it('gives the same refusal for a wrong password and an unknown address', async () => {
    const created = await account('enumeration');

    const wrongPassword = await call(loginRoute, 'POST', '/api/auth/login', {
      body: { email: created.email, password: 'definitely-not-the-password' },
    });
    const unknown = await call(loginRoute, 'POST', '/api/auth/login', {
      body: { email: `ghost-${STAMP}@example.test`, password: PASSWORD },
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPassword.error?.code).toBe(unknown.error?.code);
  });

  it('locks the account after repeated failures', async () => {
    const created = await account('lockout');

    for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
      await call(loginRoute, 'POST', '/api/auth/login', { body: { email: created.email, password: 'wrong-password' } });
    }

    const locked = await call(loginRoute, 'POST', '/api/auth/login', {
      body: { email: created.email, password: PASSWORD },
    });
    expect(locked).toMatchObject({ status: 423, error: { code: 'ACCOUNT_LOCKED' } });

    // Recorded against the account as SYSTEM: a failed sign-in proves nothing
    // about who attempted it, so it is never attributed to the account holder.
    const failures = await prisma.auditLog.findMany({
      where: { entityId: created.userId, action: AUDIT_ACTIONS.USER_LOGIN_FAILED },
      select: { actorType: true, severity: true },
    });
    expect(failures.length).toBeGreaterThanOrEqual(MAX_FAILED_LOGIN_ATTEMPTS);
    expect(failures.every((entry) => entry.actorType === 'SYSTEM')).toBe(true);
    // The one that locked the account is raised above the rest.
    expect(failures.some((entry) => entry.severity === 'WARNING')).toBe(true);
  });

  it('audits a successful sign-in and the session it created', async () => {
    const created = await account('audit-login');
    for (const action of [AUDIT_ACTIONS.USER_LOGIN_SUCCEEDED, AUDIT_ACTIONS.SESSION_CREATED]) {
      expect(
        await prisma.auditLog.count({
          where: { action, OR: [{ actorUserId: created.userId }, { entityId: created.userId }] },
        }),
        action,
      ).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!available)('account standing', () => {
  it('authenticates an unverified account but refuses it any action', async () => {
    const email = `unverified-${STAMP}@example.test`;
    await call(registerRoute, 'POST', '/api/auth/register', {
      body: { email, password: PASSWORD, fullName: 'Unverified', accountType: 'CUSTOMER', acceptedTerms: true },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, status: true } });
    users.push(user.id);
    expect(user.status).toBe('PENDING_VERIFICATION');

    const signedIn = await call(loginRoute, 'POST', '/api/auth/login', { body: { email, password: PASSWORD } });
    expect(signedIn.status).toBe(200);

    // Authenticated, and refused — a clearer signal than a blanket login failure.
    const session = await resolveSession(prisma, (signedIn.cookie ?? '').split('=')[1] ?? '');
    expect(session?.actor.accountActive).toBe(false);
    expect(authorize(session!.actor, 'project:create:own', { ownerUserId: user.id })).toEqual({
      allowed: false,
      reason: 'ACCOUNT_INACTIVE',
    });
  });

  it('cuts off a suspended account mid-session', async () => {
    const created = await account('suspended');

    const before = await call(projectsRoute, 'GET', '/api/projects', { cookie: created.cookie });
    expect(before.status).toBe(200);

    await prisma.user.update({ where: { id: created.userId }, data: { status: 'SUSPENDED' } });

    // The same cookie, now refused: standing is read from the database on every
    // request, not captured when the session was minted.
    const after = await call(projectsRoute, 'GET', '/api/projects', { cookie: created.cookie });
    expect(after).toMatchObject({ status: 403, error: { code: 'ACCOUNT_INACTIVE' } });
  });
});

describe.skipIf(!available)('sessions', () => {
  it('resolves the same identity on a later request, which is what survives a refresh', async () => {
    const created = await account('refresh');

    const first = await call(sessionRoute, 'GET', '/api/auth/session', { cookie: created.cookie });
    const second = await call(sessionRoute, 'GET', '/api/auth/session', { cookie: created.cookie });

    expect(first.data).toMatchObject({ authenticated: true, userId: created.userId });
    expect(second.data).toMatchObject({ authenticated: true, userId: created.userId });
  });

  it('refuses an expired session', async () => {
    const created = await account('expiry');
    await prisma.session.updateMany({
      where: { userId: created.userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await call(sessionRoute, 'GET', '/api/auth/session', { cookie: created.cookie });
    expect(result.data).toMatchObject({ authenticated: false });

    const protectedRoute = await call(projectsRoute, 'GET', '/api/projects', { cookie: created.cookie });
    expect(protectedRoute).toMatchObject({ status: 401, error: { code: 'UNAUTHENTICATED' } });
  });

  it('refuses a forged cookie', async () => {
    const result = await call(sessionRoute, 'GET', '/api/auth/session', {
      cookie: `${SESSION_COOKIE_NAME}=${randomUUID()}`,
    });
    expect(result.data).toMatchObject({ authenticated: false });
  });

  it('invalidates the session on logout, clears the cookie, and closes protected routes', async () => {
    const created = await account('logout');

    const out = await call(logoutRoute, 'POST', '/api/auth/logout', { cookie: created.cookie });
    // 204: logout has nothing to say, and says it without a body.
    expect(out.status).toBe(204);
    expect(out.setCookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(out.setCookie).toContain('Max-Age=0');

    // Server-side too: the row is revoked, so the cookie is worthless even if
    // it was captured before it was cleared.
    const revoked = await prisma.session.findFirst({
      where: { userId: created.userId },
      select: { revokedAt: true },
    });
    expect(revoked?.revokedAt).not.toBeNull();

    const afterwards = await call(projectsRoute, 'GET', '/api/projects', { cookie: created.cookie });
    expect(afterwards).toMatchObject({ status: 401, error: { code: 'UNAUTHENTICATED' } });

    for (const action of [AUDIT_ACTIONS.USER_LOGGED_OUT, AUDIT_ACTIONS.SESSION_REVOKED]) {
      expect(
        await prisma.auditLog.count({
          where: { action, OR: [{ actorUserId: created.userId }, { entityId: created.userId }] },
        }),
        action,
      ).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!available)('RBAC gates every dashboard', () => {
  /** The actor a signed-in holder of exactly this role would have. */
  const actorFor = (roles: RoleName[]) => ({
    userId: 'user-under-test',
    roles,
    mfaSatisfied: true,
    accountActive: true,
  });

  it('admits the role that owns each dashboard', () => {
    for (const dashboard of DASHBOARDS) {
      const held = permissionsForRoles([dashboard.role]);
      expect(
        dashboard.permissions.some((permission) => held.has(permission)),
        `${dashboard.role} → ${dashboard.path}`,
      ).toBe(true);
    }
  });

  it('refuses a customer every control-plane surface', () => {
    const customer = actorFor(['CUSTOMER']);
    for (const dashboard of DASHBOARDS.filter((entry) => entry.path.startsWith('/admin'))) {
      const allowed = dashboard.permissions.some((permission) => authorize(customer, permission).allowed);
      expect(allowed, `${dashboard.path}`).toBe(false);
    }
  });

  it('refuses an expert the finance and verification surfaces', () => {
    const expert = actorFor(['EXPERT']);
    for (const path of ['/admin/finance', '/admin/verification', '/admin']) {
      const dashboard = DASHBOARDS.find((entry) => entry.path === path)!;
      const allowed = dashboard.permissions.some((permission) => authorize(expert, permission).allowed);
      expect(allowed, path).toBe(false);
    }
  });

  it('refuses a privileged role that has not cleared MFA', () => {
    const unverified = { ...actorFor(['FINANCE']), mfaSatisfied: false };
    const finance = DASHBOARDS.find((entry) => entry.path === '/admin/finance')!;
    for (const permission of finance.permissions) {
      expect(authorize(unverified, permission)).toEqual({ allowed: false, reason: 'MFA_REQUIRED' });
    }
  });

  it('sends each role to its own landing surface', () => {
    expect(landingPath(['CUSTOMER'])).toBe('/dashboard');
    expect(landingPath(['EXPERT'])).toBe('/expert');
    expect(landingPath(['SUPPORT'])).toBe('/admin/support');
  });
});

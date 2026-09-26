/**
 * Multi-factor authentication for privileged roles, through the real routes.
 *
 * THE HOLE THIS SUITE WAS WRITTEN AROUND
 *   `login` used to mint a session as MFA-cleared whenever the account had no
 *   second factor enrolled — `mfaSatisfied: !user.mfaEnabled`. Read aloud that
 *   is "this account has no MFA, so there is no MFA outstanding", and for an
 *   administrator who simply never enrolled it meant a fully privileged session
 *   behind a password alone. The `authorize` gate could not see it: the session
 *   told it MFA was satisfied, and it believed the session.
 *
 *   So the rule is now stated as it was always meant to be — an MFA-required
 *   role must have **enrolled** a factor and **cleared** it on *this* session —
 *   and it is applied in two independent places, both server-side: when the
 *   session is minted (`login`) and again, from the account's live state, every
 *   time one is resolved (`resolveSession`). The second is what makes a role
 *   granted mid-session unable to ride a flag set before the grant.
 *
 * WHAT IS EXERCISED
 *   Every case is driven through the HTTP handlers with a real cookie, because
 *   the claim being tested is about what an attacker with a session can reach,
 *   not about what a service does when handed a hand-built actor.
 *
 * Skips cleanly when no database is reachable.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { GET as adminUsersRoute } from '../../app/api/admin/users/route';
import { POST as loginRoute } from '../../app/api/auth/login/route';
import { POST as logoutRoute } from '../../app/api/auth/logout/route';
import { PATCH as mfaConfirmRoute, POST as mfaEnrollRoute } from '../../app/api/auth/mfa/enroll/route';
import { POST as mfaVerifyRoute } from '../../app/api/auth/mfa/verify/route';
import { POST as registerRoute } from '../../app/api/auth/register/route';
import { GET as sessionRoute } from '../../app/api/auth/session/route';
import { GET as projectsRoute } from '../../app/api/projects/route';
import { generateTotpCode } from '../../lib/auth/totp';
import { authorize } from '../../lib/authz/authorize';
import { landingPath, permissionsForDashboardPath } from '../../lib/authz/dashboards';
import { type RoleName, MFA_REQUIRED_ROLES, mfaSatisfiedForSession } from '../../lib/authz/roles';
import { prisma } from '../../lib/db/client';
import { SESSION_COOKIE_NAME } from '../../lib/http/session-cookie';
import { resolveSession } from '../../services/auth/session-service';
import { isDatabaseAvailable } from '../support/lifecycle-fixtures';

const available = await isDatabaseAvailable();
const BASE = 'http://localhost:3000';
const STAMP = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const PASSWORD = 'SecondFactor!7abc';

const users: string[] = [];

afterAll(async () => {
  if (!available) return;
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: users } } });
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
}

async function call(
  handler: (request: Request) => Promise<Response>,
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
): Promise<Reply> {
  const headers = new Headers({ 'content-type': 'application/json', 'x-request-id': `mfa-${randomUUID()}` });
  if (options.cookie) headers.set('cookie', options.cookie);
  const response = await handler(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  );
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
  };
}

/**
 * Register through the real endpoint, activate, then grant roles directly.
 *
 * Roles are granted with Prisma on purpose: self-registering a privileged role
 * is refused at the boundary (that refusal has its own test), so the only
 * honest way to get an administrator here is the way the platform does it.
 */
async function person(
  label: string,
  roles: readonly RoleName[] = [],
): Promise<{ userId: string; email: string }> {
  const email = `mfa-${label}-${STAMP}@example.test`;
  await call(registerRoute, 'POST', '/api/auth/register', {
    body: { email, password: PASSWORD, fullName: `MFA ${label}`, accountType: 'CUSTOMER', acceptedTerms: true },
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  users.push(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { status: 'ACTIVE', emailVerified: new Date() },
  });

  for (const roleName of roles) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: `${roleName} role` },
      select: { id: true },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }

  return { userId: user.id, email };
}

async function signIn(email: string): Promise<Reply> {
  return call(loginRoute, 'POST', '/api/auth/login', { body: { email, password: PASSWORD } });
}

/** Enrol a second factor the way a person would, and return the TOTP secret. */
async function enrol(cookie: string): Promise<string> {
  const started = await call(mfaEnrollRoute, 'POST', '/api/auth/mfa/enroll', { cookie });
  expect(started.status, JSON.stringify(started)).toBe(201);
  const secret = started.data!.secret as string;

  const confirmed = await call(mfaConfirmRoute, 'PATCH', '/api/auth/mfa/enroll', {
    cookie,
    body: { code: await generateTotpCode(secret) },
  });
  expect(confirmed.status, JSON.stringify(confirmed)).toBe(200);
  return secret;
}

describe.skipIf(!available)('MFA is required of privileged roles, server-side', () => {
  it('refuses a privileged session that never enrolled a second factor', async () => {
    const admin = await person('unenrolled-admin', ['ADMIN']);

    const signedIn = await signIn(admin.email);
    // Signing in still works — the password was correct. What is withheld is
    // everything the role is for.
    expect(signedIn.status).toBe(200);
    expect(signedIn.data).toMatchObject({
      authenticated: true,
      mfaRequired: true,
      mfaEnrollmentRequired: true,
    });

    const cookie = signedIn.cookie!;
    const session = await call(sessionRoute, 'GET', '/api/auth/session', { cookie });
    expect(session.data).toMatchObject({
      authenticated: true,
      mfaSatisfied: false,
      mfaEnrollmentRequired: true,
    });
    // Registration grants CUSTOMER; the ADMIN grant is what raises the bar.
    expect(session.data!.roles).toContain('ADMIN');

    // The gate, at the route rather than in the UI.
    const refused = await call(adminUsersRoute, 'GET', '/api/admin/users', { cookie });
    expect(refused.status).toBe(403);
    expect(refused.error?.code).toBe('MFA_REQUIRED');
  });

  it('refuses even if the session row is forced to say MFA was satisfied', async () => {
    // Defence in depth: `resolveSession` re-derives the answer from the
    // account's live state, so tampering with the stored flag buys nothing.
    const admin = await person('forged-flag-admin', ['ADMIN']);
    const signedIn = await signIn(admin.email);
    const cookie = signedIn.cookie!;

    await prisma.session.updateMany({ where: { userId: admin.userId }, data: { mfaSatisfied: true } });

    const refused = await call(adminUsersRoute, 'GET', '/api/admin/users', { cookie });
    expect(refused.status).toBe(403);
    expect(refused.error?.code).toBe('MFA_REQUIRED');
  });

  it('admits a privileged session that enrolled and cleared the challenge', async () => {
    const admin = await person('enrolled-admin', ['ADMIN']);

    // Before the role is any use, enrol. The account is still only a CUSTOMER's
    // worth of access at this point, which is enough to reach the enroll route.
    const first = await signIn(admin.email);
    const secret = await enrol(first.cookie!);

    // Enabling MFA revokes every session, so sign in again — and this time the
    // answer is a challenge, not an enrollment prompt.
    const second = await signIn(admin.email);
    expect(second.data).toMatchObject({ mfaRequired: true, mfaEnrollmentRequired: false });
    const cookie = second.cookie!;

    const beforeChallenge = await call(adminUsersRoute, 'GET', '/api/admin/users', { cookie });
    expect(beforeChallenge.status).toBe(403);
    expect(beforeChallenge.error?.code).toBe('MFA_REQUIRED');

    const verified = await call(mfaVerifyRoute, 'POST', '/api/auth/mfa/verify', {
      cookie,
      body: { code: await generateTotpCode(secret) },
    });
    expect(verified.status, JSON.stringify(verified)).toBe(200);

    const admitted = await call(adminUsersRoute, 'GET', '/api/admin/users', { cookie });
    expect(admitted.status, JSON.stringify(admitted)).toBe(200);
  });

  it('withholds privilege again the moment the role arrives, mid-session', async () => {
    // The flag was set when this session was minted, on an account that needed
    // nothing. Granting a privileged role must not leave it standing.
    const promoted = await person('promoted-mid-session');
    const signedIn = await signIn(promoted.email);
    const cookie = signedIn.cookie!;
    expect((await call(sessionRoute, 'GET', '/api/auth/session', { cookie })).data).toMatchObject({
      mfaSatisfied: true,
    });

    const role = await prisma.role.upsert({
      where: { name: 'FINANCE' },
      update: {},
      create: { name: 'FINANCE', description: 'FINANCE role' },
      select: { id: true },
    });
    await prisma.userRole.create({ data: { userId: promoted.userId, roleId: role.id } });

    const after = await call(sessionRoute, 'GET', '/api/auth/session', { cookie });
    expect(after.data).toMatchObject({ mfaSatisfied: false, mfaEnrollmentRequired: true });
  });

  it('leaves an ordinary customer alone', async () => {
    const customer = await person('plain-customer');
    const signedIn = await signIn(customer.email);

    expect(signedIn.data).toMatchObject({
      authenticated: true,
      mfaRequired: false,
      mfaEnrollmentRequired: false,
    });

    const cookie = signedIn.cookie!;
    expect((await call(sessionRoute, 'GET', '/api/auth/session', { cookie })).data).toMatchObject({
      mfaSatisfied: true,
    });
    // And their own work is reachable without a second factor.
    expect((await call(projectsRoute, 'GET', '/api/projects', { cookie })).status).toBe(200);
  });

  it('leaves SUPPORT alone, which is the decision A-08 actually took', async () => {
    // SUPPORT is read-mostly and decides nothing, so it sits outside the gate.
    // Pinning it stops the list quietly growing.
    expect(MFA_REQUIRED_ROLES).toEqual(['ADMIN', 'SUPER_ADMIN', 'FINANCE', 'VERIFICATION_MANAGER']);

    const support = await person('support-agent', ['SUPPORT']);
    const signedIn = await signIn(support.email);
    expect(signedIn.data).toMatchObject({ mfaRequired: false, mfaEnrollmentRequired: false });
  });

  it('refuses an unauthenticated caller before it says anything about MFA', async () => {
    const anonymous = await call(adminUsersRoute, 'GET', '/api/admin/users');
    expect(anonymous.status).toBe(401);

    const forged = await call(adminUsersRoute, 'GET', '/api/admin/users', {
      cookie: `${SESSION_COOKIE_NAME}=not-a-real-token`,
    });
    expect(forged.status).toBe(401);
  });

  it('refuses a customer reaching for the control plane, on permission not MFA', async () => {
    const customer = await person('curious-customer');
    const signedIn = await signIn(customer.email);
    const refused = await call(adminUsersRoute, 'GET', '/api/admin/users', { cookie: signedIn.cookie! });

    expect(refused.status).toBe(403);
    // Not MFA_REQUIRED: telling somebody who can never hold the permission to go
    // and set up MFA is both wrong and a hint about what exists.
    expect(refused.error?.code).toBe('FORBIDDEN_RESOURCE');
  });

  it('survives a logout after MFA, and blocks the protected route afterwards', async () => {
    const admin = await person('logout-admin', ['ADMIN']);
    const secret = await enrol((await signIn(admin.email)).cookie!);

    const signedIn = await signIn(admin.email);
    const cookie = signedIn.cookie!;
    await call(mfaVerifyRoute, 'POST', '/api/auth/mfa/verify', {
      cookie,
      body: { code: await generateTotpCode(secret) },
    });
    expect((await call(adminUsersRoute, 'GET', '/api/admin/users', { cookie })).status).toBe(200);

    const loggedOut = await call(logoutRoute, 'POST', '/api/auth/logout', { cookie });
    expect(loggedOut.status).toBe(204);

    // The cookie is now worthless, MFA or not.
    expect((await call(sessionRoute, 'GET', '/api/auth/session', { cookie })).data).toMatchObject({
      authenticated: false,
    });
    expect((await call(adminUsersRoute, 'GET', '/api/admin/users', { cookie })).status).toBe(401);
    expect(await resolveSession(prisma, cookie.split('=')[1]!)).toBeNull();
  });
});

describe('the MFA rule, as a pure decision', () => {
  it('needs both enrollment and a cleared challenge from a privileged role', () => {
    for (const role of MFA_REQUIRED_ROLES) {
      expect(mfaSatisfiedForSession({ roles: [role], mfaEnrolled: false, sessionMfaSatisfied: true })).toBe(false);
      expect(mfaSatisfiedForSession({ roles: [role], mfaEnrolled: true, sessionMfaSatisfied: false })).toBe(false);
      expect(mfaSatisfiedForSession({ roles: [role], mfaEnrolled: true, sessionMfaSatisfied: true })).toBe(true);
    }
  });

  it('asks nothing extra of a role outside the set', () => {
    for (const role of ['CUSTOMER', 'EXPERT', 'SUPPORT'] as RoleName[]) {
      expect(mfaSatisfiedForSession({ roles: [role], mfaEnrolled: false, sessionMfaSatisfied: true })).toBe(true);
    }
  });

  it('applies the stricter rule when one account holds both kinds of role', () => {
    expect(
      mfaSatisfiedForSession({ roles: ['CUSTOMER', 'ADMIN'], mfaEnrolled: false, sessionMfaSatisfied: true }),
    ).toBe(false);
  });

  it('is what authorize then refuses on', () => {
    const unenrolled = {
      userId: 'u1',
      roles: ['ADMIN'] as RoleName[],
      mfaSatisfied: mfaSatisfiedForSession({
        roles: ['ADMIN'],
        mfaEnrolled: false,
        sessionMfaSatisfied: true,
      }),
      accountActive: true,
    };
    expect(authorize(unenrolled, 'user:read:any')).toEqual({ allowed: false, reason: 'MFA_REQUIRED' });
  });
});

/**
 * The whole journey, in one test, for a privileged account.
 *
 * Each step above proves one rule in isolation. This proves they compose: that
 * an administrator can actually get in and work, and that every door closes
 * behind them. A slice where each part passes alone and the sequence does not
 * is the failure mode this catches.
 *
 * On "refresh": there is no refresh endpoint to call. The session is a 7-day
 * server-side record behind an httpOnly cookie, re-resolved from the database on
 * every single request (`resolveSession`), so what a refresh actually exercises
 * is the same cookie being presented again — and that it still carries the MFA
 * clearance rather than quietly losing or re-granting it.
 */
describe.skipIf(!available)('sign up → sign in → session → role → MFA → dashboard → logout', () => {
  it('walks the whole path and closes every door behind it', async () => {
    // ---------------------------------------------------------------- SIGN UP
    const email = `journey-${STAMP}@example.test`;
    const registered = await call(registerRoute, 'POST', '/api/auth/register', {
      body: {
        email,
        password: PASSWORD,
        fullName: 'Journey Admin',
        accountType: 'CUSTOMER',
        acceptedTerms: true,
      },
    });
    // 202, not 201: registration is enumeration-safe, so it accepts the request
    // and says to check the inbox rather than confirming a user was created.
    expect(registered.status, JSON.stringify(registered)).toBe(202);

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    users.push(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', emailVerified: new Date() },
    });

    // The privileged role is granted by the platform, never self-assigned — the
    // registration boundary refuses that outright, which is its own test.
    const role = await prisma.role.upsert({
      where: { name: 'ADMIN' },
      update: {},
      create: { name: 'ADMIN', description: 'ADMIN role' },
      select: { id: true },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

    // ------------------------------------------------- SIGN IN (before MFA)
    const preEnrollment = await signIn(email);
    expect(preEnrollment.status).toBe(200);
    expect(preEnrollment.data).toMatchObject({ mfaRequired: true, mfaEnrollmentRequired: true });
    const secret = await enrol(preEnrollment.cookie!);

    // ------------------------------------------------------------ SIGN IN
    const signedIn = await signIn(email);
    expect(signedIn.status).toBe(200);
    expect(signedIn.data).toMatchObject({ mfaRequired: true, mfaEnrollmentRequired: false });
    const cookie = signedIn.cookie!;

    // ------------------------------------------------------------ SESSION
    const session = await call(sessionRoute, 'GET', '/api/auth/session', { cookie });
    expect(session.data).toMatchObject({
      authenticated: true,
      accountActive: true,
      mfaSatisfied: false,
      mfaChallengePending: true,
    });

    // ------------------------------------------------------------ REFRESH
    // Same cookie, a second time: the record is re-read, not re-issued.
    const refreshed = await call(sessionRoute, 'GET', '/api/auth/session', { cookie });
    expect(refreshed.data).toMatchObject({ authenticated: true, mfaSatisfied: false });
    expect(refreshed.data!.userId).toBe(session.data!.userId);

    // --------------------------------------------------------- ROLE CHECK
    expect(session.data!.roles).toContain('ADMIN');
    expect(session.data!.permissions).toContain('user:read:any');
    // Held on paper, and still refused in practice until the challenge passes.
    expect((await call(adminUsersRoute, 'GET', '/api/admin/users', { cookie })).error?.code).toBe(
      'MFA_REQUIRED',
    );

    // ---------------------------------------------------------------- MFA
    const verified = await call(mfaVerifyRoute, 'POST', '/api/auth/mfa/verify', {
      cookie,
      body: { code: await generateTotpCode(secret) },
    });
    expect(verified.status, JSON.stringify(verified)).toBe(200);
    expect((await call(sessionRoute, 'GET', '/api/auth/session', { cookie })).data).toMatchObject({
      mfaSatisfied: true,
      mfaChallengePending: false,
    });

    // ---------------------------------------------------------- DASHBOARD
    // A server component has no `Request`, so the page gate cannot be called
    // from here. What it *does* is exactly this: resolve the session, then ask
    // `authorize` for the union of permissions that admit a viewer to the path.
    const resolved = await resolveSession(prisma, cookie.split('=')[1]!);
    expect(resolved).not.toBeNull();
    expect(landingPath(resolved!.actor.roles)).toBe('/admin');
    const gate = permissionsForDashboardPath('/admin');
    expect(
      gate.some((permission) => authorize(resolved!.actor, permission).allowed),
      'an enrolled, cleared ADMIN must be admitted to /admin',
    ).toBe(true);
    // And the API behind that screen now answers.
    expect((await call(adminUsersRoute, 'GET', '/api/admin/users', { cookie })).status).toBe(200);

    // ------------------------------------------------------------- LOGOUT
    expect((await call(logoutRoute, 'POST', '/api/auth/logout', { cookie })).status).toBe(204);

    // ---------------------------------------------- PROTECTED ROUTE BLOCKED
    expect((await call(adminUsersRoute, 'GET', '/api/admin/users', { cookie })).status).toBe(401);
    expect((await call(projectsRoute, 'GET', '/api/projects', { cookie })).status).toBe(401);
    expect((await call(sessionRoute, 'GET', '/api/auth/session', { cookie })).data).toMatchObject({
      authenticated: false,
    });
    // The row itself is revoked, not merely un-presented.
    expect(await resolveSession(prisma, cookie.split('=')[1]!)).toBeNull();
  });
});

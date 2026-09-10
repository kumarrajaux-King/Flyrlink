/**
 * API route tests.
 *
 * Next.js route handlers are plain functions of a `Request`, so they are invoked
 * directly here — no dev server, no network. That keeps the tests fast and makes
 * the HTTP contract (status codes, cookie attributes, error envelope) assertable.
 *
 * Skips when no database is reachable, like the service integration tests.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ROLE_NAMES } from '../../lib/authz/roles';
import { prisma } from '../../lib/db/client';
import { SESSION_COOKIE_NAME } from '../../lib/http/session-cookie';

import { POST as registerRoute } from '../../app/api/auth/register/route';
import { POST as loginRoute } from '../../app/api/auth/login/route';
import { POST as logoutRoute } from '../../app/api/auth/logout/route';
import { GET as sessionRoute } from '../../app/api/auth/session/route';
import { POST as verifyEmailRoute } from '../../app/api/auth/verify-email/route';
import { POST as forgotRoute } from '../../app/api/auth/password/forgot/route';
import { POST as changePasswordRoute } from '../../app/api/auth/password/change/route';
import { POST as enrollMfaRoute } from '../../app/api/auth/mfa/enroll/route';
import { GET as backupCodesRoute } from '../../app/api/auth/mfa/backup-codes/route';
import { POST as assignRoleRoute } from '../../app/api/admin/users/[userId]/roles/route';

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const databaseAvailable = await checkDatabase();
const createdUserIds: string[] = [];

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailFor = (name: string): string => `routetest-${name}-${stamp}@example.test`;
const STRONG_PASSWORD = 'correct horse battery staple';
const BASE = 'http://localhost:3000';

beforeAll(async () => {
  if (!databaseAvailable) return;
  for (const name of ROLE_NAMES) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, description: `${name} role`, isPrivileged: false },
    });
  }
});

afterAll(async () => {
  if (databaseAvailable) {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@example.test` } } });
    if (createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdUserIds } } });
    }
  }
  await prisma.$disconnect();
});

function jsonRequest(
  path: string,
  body: unknown,
  options: { cookie?: string; requestId?: string; method?: string } = {},
): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.requestId) headers.set('x-request-id', options.requestId);
  return new Request(`${BASE}${path}`, {
    method: options.method ?? 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function getRequest(path: string, cookie?: string): Request {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new Request(`${BASE}${path}`, { method: 'GET', headers });
}

/** Extract the session cookie value from a Set-Cookie header. */
function sessionCookieFrom(response: Response): string | null {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]*)`).exec(setCookie);
  const value = match?.[1];
  return value ? `${SESSION_COOKIE_NAME}=${value}` : null;
}

/** Register + verify a user through the routes, returning a live session cookie. */
async function signedInUser(name: string): Promise<{ cookie: string; userId: string; email: string }> {
  const email = emailFor(name);

  const registered = await registerRoute(
    jsonRequest('/api/auth/register', {
      email,
      password: STRONG_PASSWORD,
      fullName: `Route ${name}`,
      accountType: 'CUSTOMER',
      acceptedTerms: true,
    }),
  );
  expect(registered.status).toBe(202);

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  createdUserIds.push(user.id);

  // The register route only emails the verification token, so it is not available
  // here. Activating the account directly is the right shortcut for a fixture:
  // the verification flow itself is covered by the service integration tests.
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: new Date(), status: 'ACTIVE' },
  });

  const loggedIn = await loginRoute(
    jsonRequest('/api/auth/login', { email, password: STRONG_PASSWORD }),
  );
  expect(loggedIn.status).toBe(200);

  const cookie = sessionCookieFrom(loggedIn);
  expect(cookie).not.toBeNull();
  return { cookie: cookie!, userId: user.id, email };
}

describe.skipIf(!databaseAvailable)('POST /api/auth/register', () => {
  it('accepts a valid registration with 202 and no user id', async () => {
    const email = emailFor('reg');
    const response = await registerRoute(
      jsonRequest('/api/auth/register', {
        email,
        password: STRONG_PASSWORD,
        fullName: 'Route Reg',
        accountType: 'CUSTOMER',
        acceptedTerms: true,
      }),
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.data.accepted).toBe(true);
    // No identifiers echoed back — that would be an enumeration signal.
    expect(JSON.stringify(body)).not.toContain('userId');
    expect(JSON.stringify(body)).not.toContain('verificationToken');

    const created = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    createdUserIds.push(created!.id);
  });

  it('returns an identical response for an already-registered address', async () => {
    const email = emailFor('reg-dupe');
    const payload = {
      email,
      password: STRONG_PASSWORD,
      fullName: 'Route Dupe',
      accountType: 'CUSTOMER' as const,
      acceptedTerms: true as const,
    };

    const first = await registerRoute(jsonRequest('/api/auth/register', payload));
    const second = await registerRoute(jsonRequest('/api/auth/register', payload));

    expect(first.status).toBe(second.status);
    expect(await first.json()).toEqual(await second.json());

    const created = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    createdUserIds.push(created!.id);
  });

  it('rejects an unknown field with 422 and field-level details', async () => {
    const response = await registerRoute(
      jsonRequest('/api/auth/register', {
        email: emailFor('reg-extra'),
        password: STRONG_PASSWORD,
        fullName: 'Route Extra',
        accountType: 'CUSTOMER',
        acceptedTerms: true,
        role: 'SUPER_ADMIN',
      }),
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.requestId).toBeTypeOf('string');
  });

  it('reports each invalid field', async () => {
    const response = await registerRoute(
      jsonRequest('/api/auth/register', {
        email: 'not-an-email',
        password: 'short',
        fullName: 'A',
        accountType: 'CUSTOMER',
        acceptedTerms: true,
      }),
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(Object.keys(body.error.details).sort()).toEqual(['email', 'fullName', 'password']);
  });

  it('rejects malformed JSON with 400', async () => {
    const request = new Request(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const response = await registerRoute(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('MALFORMED_JSON');
  });
});

describe.skipIf(!databaseAvailable)('POST /api/auth/login', () => {
  it('sets an httpOnly, SameSite=Lax session cookie', async () => {
    const { email } = await signedInUser('login-cookie');

    const response = await loginRoute(
      jsonRequest('/api/auth/login', { email, password: STRONG_PASSWORD }),
    );
    expect(response.status).toBe(200);

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = await response.json();
    expect(body.data.authenticated).toBe(true);
    expect(body.data.mfaRequired).toBe(false);
  });

  it('returns 401 with a stable code on bad credentials', async () => {
    const { email } = await signedInUser('login-bad');
    const response = await loginRoute(
      jsonRequest('/api/auth/login', { email, password: 'definitely wrong' }),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('INVALID_CREDENTIALS');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('never echoes the password back', async () => {
    const response = await loginRoute(
      jsonRequest('/api/auth/login', { email: emailFor('ghost'), password: STRONG_PASSWORD }),
    );
    expect(await response.text()).not.toContain(STRONG_PASSWORD);
  });
});

describe.skipIf(!databaseAvailable)('GET /api/auth/session', () => {
  it('reports unauthenticated without a cookie', async () => {
    const response = await sessionRoute(getRequest('/api/auth/session'));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ authenticated: false });
  });

  it('returns identity, roles and permissions with a valid cookie', async () => {
    const { cookie, userId } = await signedInUser('session');
    const response = await sessionRoute(getRequest('/api/auth/session', cookie));

    const body = await response.json();
    expect(body.data.authenticated).toBe(true);
    expect(body.data.userId).toBe(userId);
    expect(body.data.roles).toEqual(['CUSTOMER']);
    expect(body.data.accountActive).toBe(true);
    expect(body.data.permissions).toContain('project:create:own');
    expect(body.data.permissions).not.toContain('audit:read:any');
  });

  it('ignores a forged cookie value', async () => {
    const response = await sessionRoute(
      getRequest('/api/auth/session', `${SESSION_COOKIE_NAME}=${'A'.repeat(43)}`),
    );
    expect((await response.json()).data).toEqual({ authenticated: false });
  });
});

describe.skipIf(!databaseAvailable)('POST /api/auth/logout', () => {
  it('clears the cookie and invalidates the session', async () => {
    const { cookie } = await signedInUser('logout');

    const response = await logoutRoute(jsonRequest('/api/auth/logout', {}, { cookie }));
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');

    // The same cookie must no longer resolve.
    const after = await sessionRoute(getRequest('/api/auth/session', cookie));
    expect((await after.json()).data).toEqual({ authenticated: false });
  });

  it('is idempotent without a session', async () => {
    const response = await logoutRoute(jsonRequest('/api/auth/logout', {}));
    expect(response.status).toBe(204);
  });
});

describe.skipIf(!databaseAvailable)('authentication is required where it should be', () => {
  it('returns 401 UNAUTHENTICATED for protected routes without a session', async () => {
    const cases: Array<[string, Promise<Response>]> = [
      ['change password', changePasswordRoute(jsonRequest('/api/auth/password/change', {
        currentPassword: 'x',
        newPassword: STRONG_PASSWORD,
      }))],
      ['mfa enroll', enrollMfaRoute(jsonRequest('/api/auth/mfa/enroll', {}))],
      ['backup codes', backupCodesRoute(getRequest('/api/auth/mfa/backup-codes'))],
    ];

    for (const [label, promise] of cases) {
      const response = await promise;
      expect(response.status, `${label} should be 401`).toBe(401);
      expect((await response.json()).error.code, label).toBe('UNAUTHENTICATED');
    }
  });

  it('returns 403 when a customer attempts role assignment', async () => {
    const { cookie } = await signedInUser('escalate');
    const target = await signedInUser('escalate-target');

    const response = await assignRoleRoute(
      jsonRequest(`/api/admin/users/${target.userId}/roles`, { role: 'SUPER_ADMIN' }, { cookie }),
      { params: Promise.resolve({ userId: target.userId }) },
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('FORBIDDEN_RESOURCE');

    // And the role was genuinely not granted.
    const roles = await prisma.userRole.findMany({
      where: { userId: target.userId, revokedAt: null },
      select: { role: { select: { name: true } } },
    });
    expect(roles.map((r) => r.role.name)).toEqual(['CUSTOMER']);
  });
});

describe.skipIf(!databaseAvailable)('response envelope', () => {
  it('echoes a supplied request id and always sets one', async () => {
    const supplied = 'req-test-12345';
    const withId = await sessionRoute(
      new Request(`${BASE}/api/auth/session`, {
        method: 'GET',
        headers: { 'x-request-id': supplied },
      }),
    );
    expect(withId.headers.get('x-request-id')).toBe(supplied);

    const withoutId = await sessionRoute(getRequest('/api/auth/session'));
    expect(withoutId.headers.get('x-request-id')).toMatch(/[0-9a-f-]{36}/);
  });

  it('marks auth responses no-store', async () => {
    const response = await sessionRoute(getRequest('/api/auth/session'));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('includes a request id in error bodies for support correlation', async () => {
    const response = await verifyEmailRoute(
      jsonRequest('/api/auth/verify-email', { token: 'A'.repeat(43) }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
    expect(body.error.requestId).toBeTypeOf('string');
  });
});

describe.skipIf(!databaseAvailable)('POST /api/auth/password/forgot', () => {
  it('returns the same 202 for known and unknown addresses', async () => {
    const { email } = await signedInUser('forgot');

    const known = await forgotRoute(jsonRequest('/api/auth/password/forgot', { email }));
    const unknown = await forgotRoute(
      jsonRequest('/api/auth/password/forgot', { email: emailFor('nobody-at-all') }),
    );

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await known.json()).toEqual(await unknown.json());
  });

  it('never returns the reset token in the response', async () => {
    const { email, userId } = await signedInUser('forgot-token');
    const response = await forgotRoute(jsonRequest('/api/auth/password/forgot', { email }));

    const text = await response.text();
    expect(text).not.toContain('resetToken');

    // A token WAS created — it just travels by email only.
    const tokens = await prisma.verificationToken.count({
      where: { userId, type: 'PASSWORD_RESET', consumedAt: null },
    });
    expect(tokens).toBe(1);
  });
});

describe.skipIf(!databaseAvailable)('POST /api/auth/password/change', () => {
  it('changes the password for a signed-in caller', async () => {
    const { cookie, email } = await signedInUser('change');
    const newPassword = 'an entirely different passphrase';

    const response = await changePasswordRoute(
      jsonRequest(
        '/api/auth/password/change',
        { currentPassword: STRONG_PASSWORD, newPassword },
        { cookie },
      ),
    );
    expect(response.status).toBe(200);

    const relogin = await loginRoute(
      jsonRequest('/api/auth/login', { email, password: newPassword }),
    );
    expect(relogin.status).toBe(200);
  });

  it('returns 403 when the current password is wrong', async () => {
    const { cookie } = await signedInUser('change-wrong');
    const response = await changePasswordRoute(
      jsonRequest(
        '/api/auth/password/change',
        { currentPassword: 'nope nope nope', newPassword: 'another long passphrase here' },
        { cookie },
      ),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe.skipIf(!databaseAvailable)('POST /api/auth/mfa/enroll', () => {
  it('returns a secret and otpauth URI, without enabling MFA yet', async () => {
    const { cookie, userId } = await signedInUser('mfa-enroll');

    const response = await enrollMfaRoute(jsonRequest('/api/auth/mfa/enroll', {}, { cookie }));
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.data.secret).toMatch(/^[A-Z2-7]+$/);
    expect(body.data.otpauthUri.startsWith('otpauth://totp/')).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaEnabled: true },
    });
    expect(user.mfaEnabled).toBe(false);
  });
});

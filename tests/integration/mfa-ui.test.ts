/**
 * The MFA screens: who may open them, and where each one sends people.
 *
 * WHAT IS BEING TESTED, AND WHAT IS NOT
 *   These are server components, so the thing worth pinning is the *gate* —
 *   the decision each page makes before it renders anything. That decision is
 *   made from a real session resolved out of the database, so the tests drive
 *   it with real users, real cookies and real roles rather than stubs, and
 *   assert on the redirect each page issues.
 *
 *   `next/headers` and `next/navigation` are the only things faked, because a
 *   server component has no request to read a cookie from outside a running
 *   Next server. `redirect()` is replaced with something that throws a
 *   catchable marker, which is what the real one does — it throws so the rest
 *   of the component never runs.
 *
 *   The markup itself is covered by the browser walkthrough
 *   (`scripts/mfa-browser-check.mts`), which drives the real forms.
 *
 * Skips cleanly when no database is reachable.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateTotpCode } from '../../lib/auth/totp';
import type { RoleName } from '../../lib/authz/roles';
import { prisma } from '../../lib/db/client';
import { SESSION_COOKIE_NAME } from '../../lib/http/session-cookie';
import { isDatabaseAvailable } from '../support/lifecycle-fixtures';

const available = await isDatabaseAvailable();

/** The cookie the faked `cookies()` will hand back. Set per test. */
let currentToken: string | null = null;

/** Thrown by the faked `redirect`, exactly as the real one aborts rendering. */
class Redirected extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect(${to})`);
    this.name = 'Redirected';
    this.to = to;
  }
}

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE_NAME && currentToken ? { name, value: currentToken } : undefined,
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const { default: MfaChallengePage } = await import('../../app/(auth)/login/mfa/page');
const { default: MfaSecurityPage } = await import('../../app/(app)/dashboard/security/mfa/page');

const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'MfaScreens!4uvw';
const users: string[] = [];

afterAll(async () => {
  if (!available) return;
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: users } } });
  await prisma.mfaBackupCode.deleteMany({ where: { userId: { in: users } } });
  await prisma.session.deleteMany({ where: { userId: { in: users } } });
  await prisma.customerProfile.deleteMany({ where: { userId: { in: users } } });
  await prisma.expertProfile.deleteMany({ where: { userId: { in: users } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: users } } });
  await prisma.verificationToken.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  currentToken = null;
});

/** Where a page sent the viewer, or `null` when it rendered instead. */
async function open(
  render: () => Promise<unknown>,
): Promise<{ redirectedTo: string | null; rendered: unknown }> {
  try {
    const rendered = await render();
    return { redirectedTo: null, rendered };
  } catch (error) {
    if (error instanceof Redirected) return { redirectedTo: error.to, rendered: null };
    throw error;
  }
}

const challenge = (next?: string) =>
  open(() => MfaChallengePage({ searchParams: Promise.resolve(next === undefined ? {} : { next }) }));

const security = () => open(() => MfaSecurityPage());

/** Register through the service layer, activate, grant roles, and sign in. */
async function signedIn(
  label: string,
  options: { roles?: readonly RoleName[]; enrolMfa?: boolean } = {},
): Promise<{ userId: string; token: string; secret?: string }> {
  const { login } = await import('../../services/auth/login-service');
  const { hashPassword } = await import('../../lib/auth/password');

  const user = await prisma.user.create({
    data: {
      // Lower-cased: `login` normalises the address before looking it up, so a
      // label with a capital in it would never be found again.
      email: `mfaui-${label}-${STAMP}@example.test`.toLowerCase(),
      fullName: `Mfa Ui ${label}`,
      passwordHash: await hashPassword(PASSWORD),
      status: 'ACTIVE',
      emailVerified: new Date(),
    },
    select: { id: true, email: true },
  });
  users.push(user.id);

  for (const roleName of options.roles ?? []) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: `${roleName} role` },
      select: { id: true },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }

  let secret: string | undefined;
  if (options.enrolMfa) {
    const { beginMfaEnrollment, confirmMfaEnrollment } = await import('../../services/auth/mfa-service');
    const started = await beginMfaEnrollment({ userId: user.id });
    secret = started!.secret;
    await confirmMfaEnrollment({ userId: user.id, code: await generateTotpCode(secret) });
  }

  const outcome = await login({ email: user.email, password: PASSWORD });
  if (!('session' in outcome)) throw new Error(`login did not return a session: ${outcome.result}`);
  return secret === undefined
    ? { userId: user.id, token: outcome.session.rawToken }
    : { userId: user.id, token: outcome.session.rawToken, secret };
}

describe.skipIf(!available)('the challenge page decides where somebody belongs', () => {
  it('sends a visitor with no session to sign in, carrying where they were going', async () => {
    expect((await challenge('/admin/finance')).redirectedTo).toBe(
      '/login?next=%2Fadmin%2Ffinance',
    );
  });

  it('sends a visitor with a dead cookie to sign in, not to a broken challenge', async () => {
    currentToken = randomUUID();
    expect((await challenge()).redirectedTo).toBe('/login?next=%2Fdashboard');
  });

  it('sends a privileged account with no factor to enrollment, not to a challenge', async () => {
    // There is nothing generating codes, so a challenge would be unanswerable.
    const admin = await signedIn('unenrolled', { roles: ['ADMIN'] });
    currentToken = admin.token;
    expect((await challenge()).redirectedTo).toBe('/dashboard/security/mfa');
  });

  it('passes an already-cleared session straight through to where it was going', async () => {
    const customer = await signedIn('cleared');
    currentToken = customer.token;
    expect((await challenge('/projects')).redirectedTo).toBe('/projects');
  });

  it('renders the challenge for an enrolled account that has not cleared it', async () => {
    const admin = await signedIn('enrolled', { roles: ['ADMIN'], enrolMfa: true });
    currentToken = admin.token;
    const opened = await challenge('/admin');
    expect(opened.redirectedTo).toBeNull();
    expect(opened.rendered).not.toBeNull();
  });

  it('refuses to bounce back into itself, however `next` is set', async () => {
    const admin = await signedIn('loop', { roles: ['ADMIN'], enrolMfa: true });
    currentToken = admin.token;
    // Clear the factor so the page would pass through, making the `next` visible.
    await prisma.session.updateMany({ where: { userId: admin.userId }, data: { mfaSatisfied: true } });

    for (const hostile of ['/login/mfa', '/login', '//evil.test', 'https://evil.test', '/\\evil.test']) {
      expect((await challenge(hostile)).redirectedTo, hostile).toBe('/dashboard');
    }
  });
});

describe.skipIf(!available)('the enrollment page is reachable by the people who need it', () => {
  it('sends an anonymous visitor to sign in and back', async () => {
    expect((await security()).redirectedTo).toBe('/login?next=%2Fdashboard%2Fsecurity%2Fmfa');
  });

  it('opens for a privileged account that has cleared nothing at all', async () => {
    // The case a permission gate would get wrong: an un-cleared ADMIN holds no
    // usable permission, so gating this screen on one would refuse exactly the
    // person it exists for.
    for (const role of ['ADMIN', 'SUPER_ADMIN', 'FINANCE', 'VERIFICATION_MANAGER'] as RoleName[]) {
      const who = await signedIn(`needs-${role}`, { roles: [role] });
      currentToken = who.token;
      const opened = await security();
      expect(opened.redirectedTo, role).toBeNull();
      expect(opened.rendered, role).not.toBeNull();
    }
  });

  it('opens for an ordinary customer too, who may enrol by choice', async () => {
    const customer = await signedIn('optional-customer');
    currentToken = customer.token;
    expect((await security()).redirectedTo).toBeNull();
  });

  it('opens for an account that already has a factor, to show it is on', async () => {
    const admin = await signedIn('already-on', { roles: ['ADMIN'], enrolMfa: true });
    currentToken = admin.token;
    expect((await security()).redirectedTo).toBeNull();
  });

  it('sends a suspended account away rather than letting it enrol', async () => {
    const who = await signedIn('suspended', { roles: ['ADMIN'] });
    await prisma.user.update({ where: { id: who.userId }, data: { status: 'SUSPENDED' } });
    currentToken = who.token;
    // `getCurrentUser` still resolves — the session is valid — and the account
    // is simply not ACTIVE. The screen opens; every endpoint behind it refuses
    // with ACCOUNT_INACTIVE, which is the server's decision, not the page's.
    const opened = await security();
    expect(opened.redirectedTo).toBeNull();
  });
});

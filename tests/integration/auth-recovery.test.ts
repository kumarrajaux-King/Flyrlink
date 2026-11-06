/**
 * The recovery paths, through the real routes.
 *
 * WHAT WAS ACTUALLY BROKEN
 *   `POST /api/auth/verify-email` and `/api/auth/password/reset` were built and
 *   tested in Phase 4. Nothing could reach them: the emails linked to
 *   `/verify-email?token=…` and `/reset-password?token=…`, and neither page
 *   existed, so every account created through the product landed on a 404 and
 *   could never be activated. Passing service tests said nothing about that,
 *   which is why these drive the HTTP surface instead.
 *
 *   A lapsed verification link was also a dead end — the account cannot sign
 *   in, and registering again fails on the unique email. `resend` is the way
 *   out, and it is rate-limited so it cannot be turned on somebody's inbox.
 *
 * Skips cleanly when no database is reachable.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { POST as forgotRoute } from '../../app/api/auth/password/forgot/route';
import { POST as resetRoute } from '../../app/api/auth/password/reset/route';
import { POST as loginRoute } from '../../app/api/auth/login/route';
import { POST as registerRoute } from '../../app/api/auth/register/route';
import { POST as resendRoute } from '../../app/api/auth/verify-email/resend/route';
import { POST as verifyEmailRoute } from '../../app/api/auth/verify-email/route';
import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import { hashToken } from '../../lib/auth/tokens';
import { prisma } from '../../lib/db/client';
import { VERIFICATION_RESEND_COOLDOWN_MS } from '../../services/auth/account-service';
import { isDatabaseAvailable } from '../support/lifecycle-fixtures';

const available = await isDatabaseAvailable();
const BASE = 'http://localhost:3000';
const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'RecoveryFlow!6stu';

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
  path: string,
  body?: unknown,
): Promise<Reply> {
  const response = await handler(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': `rec-${randomUUID()}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
 * Register through the real endpoint and recover the emailed token.
 *
 * The raw token is never returned by the API — only its digest is stored — so
 * a test has to mint the comparison the same way the service does. Reading the
 * row and re-hashing a guess would prove nothing; instead the token is issued
 * here and the row is pointed at it, which is what the mail would have carried.
 */
async function register(label: string): Promise<{ email: string; userId: string; token: string }> {
  const email = `recovery-${label}-${STAMP}@example.test`.toLowerCase();
  const result = await call(registerRoute, '/api/auth/register', {
    email,
    password: PASSWORD,
    fullName: `Recovery ${label}`,
    accountType: 'CUSTOMER',
    acceptedTerms: true,
  });
  expect(result.status, JSON.stringify(result)).toBe(202);

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  users.push(user.id);

  // Replace the stored digest with one whose raw value this test knows. The
  // service's own issuing path is covered by `auth.test.ts`; what matters here
  // is that the *route* accepts a token that came out of an email.
  const token = randomUUID().replace(/-/g, '');
  await prisma.verificationToken.updateMany({
    where: { userId: user.id, type: 'EMAIL_VERIFICATION', consumedAt: null },
    data: { tokenHash: hashToken(token) },
  });

  return { email, userId: user.id, token };
}

describe.skipIf(!available)('email verification, over HTTP', () => {
  it('activates an account and lets it sign in', async () => {
    const who = await register('verify-happy');

    // Before: registered, but not permitted to act.
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: who.userId },
      select: { status: true, emailVerified: true },
    });
    expect(before.status).toBe('PENDING_VERIFICATION');
    expect(before.emailVerified).toBeNull();

    const verified = await call(verifyEmailRoute, '/api/auth/verify-email', { token: who.token });
    expect(verified.status, JSON.stringify(verified)).toBe(200);
    expect(verified.data).toMatchObject({ verified: true });

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: who.userId },
      select: { status: true, emailVerified: true },
    });
    expect(after.status).toBe('ACTIVE');
    expect(after.emailVerified).not.toBeNull();

    const signedIn = await call(loginRoute, '/api/auth/login', { email: who.email, password: PASSWORD });
    expect(signedIn.status).toBe(200);
    expect(signedIn.cookie).toBeDefined();
  });

  it('treats a second click as success, not an error', async () => {
    const who = await register('verify-twice');
    await call(verifyEmailRoute, '/api/auth/verify-email', { token: who.token });

    const again = await call(verifyEmailRoute, '/api/auth/verify-email', { token: who.token });
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ verified: true, alreadyVerified: true });
  });

  it('refuses an expired link', async () => {
    const who = await register('verify-expired');
    await prisma.verificationToken.updateMany({
      where: { userId: who.userId, type: 'EMAIL_VERIFICATION' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await call(verifyEmailRoute, '/api/auth/verify-email', { token: who.token });
    expect(result.status).toBe(400);
    expect(result.error?.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });

  it('refuses an invented link, and says nothing about whose it might be', async () => {
    const result = await call(verifyEmailRoute, '/api/auth/verify-email', {
      token: randomUUID().replace(/-/g, ''),
    });
    expect(result.status).toBe(400);
    expect(result.error?.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });

  it('refuses to sign in an account that has not verified', async () => {
    const who = await register('verify-unverified');
    const signedIn = await call(loginRoute, '/api/auth/login', { email: who.email, password: PASSWORD });
    // Authentication succeeds — the password was right. Acting does not: the
    // account is PENDING_VERIFICATION, and `authorize` refuses it.
    expect(signedIn.status).toBe(200);
    const { resolveSession } = await import('../../services/auth/session-service');
    const resolved = await resolveSession(prisma, signedIn.cookie!.split('=')[1]!);
    expect(resolved?.actor.accountActive).toBe(false);
  });
});

describe.skipIf(!available)('resending a verification link', () => {
  it('issues a new link and retires the old one', async () => {
    const who = await register('resend');
    // Past the cooldown the registration token set.
    await prisma.verificationToken.updateMany({
      where: { userId: who.userId, type: 'EMAIL_VERIFICATION', consumedAt: null },
      data: { createdAt: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS - 1000) },
    });

    const resent = await call(resendRoute, '/api/auth/verify-email/resend', { email: who.email });
    expect(resent.status).toBe(202);

    // The original link is dead — two live links is one more than anyone needs.
    const old = await call(verifyEmailRoute, '/api/auth/verify-email', { token: who.token });
    expect(old.status).toBe(400);

    const fresh = await prisma.verificationToken.findFirst({
      where: { userId: who.userId, type: 'EMAIL_VERIFICATION', consumedAt: null },
      select: { id: true },
    });
    expect(fresh).not.toBeNull();
  });

  it('holds off inside the cooldown, so the endpoint cannot flood an inbox', async () => {
    const who = await register('resend-cooldown');
    const before = await prisma.verificationToken.count({ where: { userId: who.userId } });

    const resent = await call(resendRoute, '/api/auth/verify-email/resend', { email: who.email });
    // Still 202: saying "too soon" would confirm the address is registered.
    expect(resent.status).toBe(202);
    expect(await prisma.verificationToken.count({ where: { userId: who.userId } })).toBe(before);

    // And the link they already have still works — a suppressed request must
    // be a complete no-op, not a way to strand somebody with a dead token.
    expect((await call(verifyEmailRoute, '/api/auth/verify-email', { token: who.token })).status).toBe(200);
  });

  it('answers the same way for an address that does not exist', async () => {
    const result = await call(resendRoute, '/api/auth/verify-email/resend', {
      email: `nobody-${STAMP}@example.test`,
    });
    expect(result.status).toBe(202);
    expect(result.data).toMatchObject({ accepted: true });
  });

  it('answers the same way for an account that is already verified', async () => {
    const who = await register('resend-verified');
    await call(verifyEmailRoute, '/api/auth/verify-email', { token: who.token });

    const before = await prisma.verificationToken.count({ where: { userId: who.userId } });
    const result = await call(resendRoute, '/api/auth/verify-email/resend', { email: who.email });
    expect(result.status).toBe(202);
    expect(await prisma.verificationToken.count({ where: { userId: who.userId } })).toBe(before);
  });

  it('records the resend in the audit log', async () => {
    const who = await register('resend-audit');
    await prisma.verificationToken.updateMany({
      where: { userId: who.userId, type: 'EMAIL_VERIFICATION', consumedAt: null },
      data: { createdAt: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS - 1000) },
    });
    await call(resendRoute, '/api/auth/verify-email/resend', { email: who.email });

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: who.userId, action: AUDIT_ACTIONS.USER_EMAIL_VERIFICATION_RESENT },
      select: { id: true, severity: true },
    });
    expect(entry).not.toBeNull();
    expect(entry?.severity).toBe('NOTICE');
  });
});

describe.skipIf(!available)('forgotten password, over HTTP', () => {
  /** Register, verify, and return the account ready to recover. */
  async function active(label: string): Promise<{ email: string; userId: string }> {
    const who = await register(label);
    await call(verifyEmailRoute, '/api/auth/verify-email', { token: who.token });
    return { email: who.email, userId: who.userId };
  }

  /** Point the outstanding reset row at a token this test knows. */
  async function resetToken(userId: string): Promise<string> {
    const token = randomUUID().replace(/-/g, '');
    const updated = await prisma.verificationToken.updateMany({
      where: { userId, type: 'PASSWORD_RESET', consumedAt: null },
      data: { tokenHash: hashToken(token) },
    });
    expect(updated.count).toBe(1);
    return token;
  }

  it('answers identically for a registered and an unregistered address', async () => {
    const who = await active('forgot-known');

    const known = await call(forgotRoute, '/api/auth/password/forgot', { email: who.email });
    const unknown = await call(forgotRoute, '/api/auth/password/forgot', {
      email: `ghost-${STAMP}@example.test`,
    });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.data).toEqual(unknown.data);
  });

  it('resets the password, kills every session, and lets the new one in', async () => {
    const who = await active('forgot-reset');

    // A live session, to prove the reset takes it down.
    const before = await call(loginRoute, '/api/auth/login', { email: who.email, password: PASSWORD });
    const { resolveSession } = await import('../../services/auth/session-service');
    expect(await resolveSession(prisma, before.cookie!.split('=')[1]!)).not.toBeNull();

    await call(forgotRoute, '/api/auth/password/forgot', { email: who.email });
    const token = await resetToken(who.userId);

    const newPassword = 'a completely different passphrase';
    const reset = await call(resetRoute, '/api/auth/password/reset', { token, password: newPassword });
    expect(reset.status, JSON.stringify(reset)).toBe(200);

    // Every session is gone — a reset is the recovery path for a compromised
    // account, so any session an attacker holds must die with it.
    expect(await resolveSession(prisma, before.cookie!.split('=')[1]!)).toBeNull();

    expect((await call(loginRoute, '/api/auth/login', { email: who.email, password: PASSWORD })).status).toBe(401);
    expect(
      (await call(loginRoute, '/api/auth/login', { email: who.email, password: newPassword })).status,
    ).toBe(200);
  });

  it('spends a reset token exactly once', async () => {
    const who = await active('forgot-once');
    await call(forgotRoute, '/api/auth/password/forgot', { email: who.email });
    const token = await resetToken(who.userId);

    expect((await call(resetRoute, '/api/auth/password/reset', { token, password: 'first new passphrase' })).status).toBe(200);
    const second = await call(resetRoute, '/api/auth/password/reset', { token, password: 'second new passphrase' });
    expect(second.status).toBe(400);
    expect(second.error?.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });

  it('refuses an expired reset link', async () => {
    const who = await active('forgot-expired');
    await call(forgotRoute, '/api/auth/password/forgot', { email: who.email });
    const token = await resetToken(who.userId);

    await prisma.verificationToken.updateMany({
      where: { userId: who.userId, type: 'PASSWORD_RESET', consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await call(resetRoute, '/api/auth/password/reset', { token, password: 'never applied passphrase' });
    expect(result.status).toBe(400);
    expect(result.error?.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });

  it('refuses a weak new password without spending the token', async () => {
    const who = await active('forgot-weak');
    await call(forgotRoute, '/api/auth/password/forgot', { email: who.email });
    const token = await resetToken(who.userId);

    const weak = await call(resetRoute, '/api/auth/password/reset', { token, password: 'short' });
    expect(weak.status).toBe(422);

    // The link must survive a rejected attempt, or one typo strands the person.
    expect(
      (await call(resetRoute, '/api/auth/password/reset', { token, password: 'a long enough passphrase' })).status,
    ).toBe(200);
  });
});

describe.skipIf(!available)('rate limiting on the authentication surface', () => {
  it('locks an account after repeated wrong passwords, and says so plainly', async () => {
    const who = await register('lockout-password');
    await call(verifyEmailRoute, '/api/auth/verify-email', { token: who.token });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await call(loginRoute, '/api/auth/login', { email: who.email, password: 'not the password' });
      expect(wrong.status, `attempt ${attempt}`).toBe(401);
      expect(wrong.error?.code).toBe('INVALID_CREDENTIALS');
    }

    // Now even the correct password is refused, and with a different code —
    // safe to disclose, because the caller just demonstrated the failures.
    const locked = await call(loginRoute, '/api/auth/login', { email: who.email, password: PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.error?.code).toBe('ACCOUNT_LOCKED');
  });

  it('counts a wrong MFA code against the same lockout, so the second factor cannot be brute-forced', async () => {
    // Three valid values in a million, and until this existed, unlimited
    // guesses — which made the second factor decorative against anyone
    // willing to spend a few hours of traffic.
    const { beginMfaEnrollment, confirmMfaEnrollment, verifyMfaChallenge } = await import(
      '../../services/auth/mfa-service'
    );
    const { generateTotpCode } = await import('../../lib/auth/totp');

    const who = await register('lockout-mfa');
    await call(verifyEmailRoute, '/api/auth/verify-email', { token: who.token });

    const started = await beginMfaEnrollment({ userId: who.userId });
    await confirmMfaEnrollment({ userId: who.userId, code: await generateTotpCode(started!.secret) });

    const signedIn = await call(loginRoute, '/api/auth/login', { email: who.email, password: PASSWORD });
    const { resolveSession } = await import('../../services/auth/session-service');
    const session = await resolveSession(prisma, signedIn.cookie!.split('=')[1]!);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const outcome = await verifyMfaChallenge({
        userId: who.userId,
        sessionId: session!.sessionId,
        code: '000000',
      });
      expect(outcome.result, `attempt ${attempt}`).toBe('INVALID');
    }

    const fifth = await verifyMfaChallenge({
      userId: who.userId,
      sessionId: session!.sessionId,
      code: '000000',
    });
    expect(fifth.result).toBe('LOCKED');

    // And a correct code is refused too, until the lockout lapses.
    const correct = await verifyMfaChallenge({
      userId: who.userId,
      sessionId: session!.sessionId,
      code: await generateTotpCode(started!.secret),
    });
    expect(correct.result).toBe('LOCKED');

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: who.userId },
      select: { failedLoginCount: true, lockedUntil: true },
    });
    expect(user.failedLoginCount).toBeGreaterThanOrEqual(5);
    expect(user.lockedUntil).not.toBeNull();
  });

  it('clears the counter when the challenge is finally answered', async () => {
    const { beginMfaEnrollment, confirmMfaEnrollment, verifyMfaChallenge } = await import(
      '../../services/auth/mfa-service'
    );
    const { generateTotpCode } = await import('../../lib/auth/totp');

    const who = await register('lockout-mfa-clears');
    await call(verifyEmailRoute, '/api/auth/verify-email', { token: who.token });

    const started = await beginMfaEnrollment({ userId: who.userId });
    await confirmMfaEnrollment({ userId: who.userId, code: await generateTotpCode(started!.secret) });

    const signedIn = await call(loginRoute, '/api/auth/login', { email: who.email, password: PASSWORD });
    const { resolveSession } = await import('../../services/auth/session-service');
    const session = await resolveSession(prisma, signedIn.cookie!.split('=')[1]!);

    expect(
      (await verifyMfaChallenge({ userId: who.userId, sessionId: session!.sessionId, code: '000000' })).result,
    ).toBe('INVALID');

    const ok = await verifyMfaChallenge({
      userId: who.userId,
      sessionId: session!.sessionId,
      code: await generateTotpCode(started!.secret),
    });
    expect(ok.result).toBe('SATISFIED');

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: who.userId },
      select: { failedLoginCount: true, lockedUntil: true },
    });
    expect(user.failedLoginCount).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });

  it('records every refusal in the audit log', async () => {
    const who = await register('lockout-audit');
    await call(verifyEmailRoute, '/api/auth/verify-email', { token: who.token });
    await call(loginRoute, '/api/auth/login', { email: who.email, password: 'wrong again' });

    const failures = await prisma.auditLog.count({
      where: { entityId: who.userId, action: AUDIT_ACTIONS.USER_LOGIN_FAILED },
    });
    expect(failures).toBeGreaterThan(0);
  });
});

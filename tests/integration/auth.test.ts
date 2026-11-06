/**
 * Authentication and RBAC integration tests.
 *
 * Runs against a real PostgreSQL database via the Prisma client, exercising the
 * complete flow: registration, email verification, login, sessions, lockout,
 * password reset, MFA enrollment and challenge, role assignment, and the audit
 * trail each of those must leave behind.
 *
 * Skips cleanly when no database is reachable, so `npm test` still passes on a
 * machine without one. Start it with `npm run db:dev-server` (or Docker Compose).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashToken } from '../../lib/auth/tokens';
import { generateTotpCode } from '../../lib/auth/totp';
import { authorize } from '../../lib/authz/authorize';
import { ROLE_NAMES } from '../../lib/authz/roles';
import { prisma } from '../../lib/db/client';
import {
  VERIFICATION_RESEND_COOLDOWN_MS,
  changePassword,
  registerUser,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from '../../services/auth/account-service';
import {
  MAX_FAILED_LOGIN_ATTEMPTS,
  clearLockout,
  login,
  logout,
} from '../../services/auth/login-service';
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  countUnusedBackupCodes,
  disableMfa,
  regenerateBackupCodes,
  verifyMfaChallenge,
} from '../../services/auth/mfa-service';
import { assignRole, revokeRole, rolesForUser } from '../../services/auth/role-service';
import { resolveSession } from '../../services/auth/session-service';

/**
 * Resolved at module load, not in `beforeAll`: `describe.skipIf` is evaluated
 * during collection, so a flag set in a hook would always still be false.
 */
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

/** Unique per run so repeated runs never collide. */
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailFor = (name: string): string => `authtest-${name}-${stamp}@example.test`;
const STRONG_PASSWORD = 'correct horse battery staple';

beforeAll(async () => {
  if (!databaseAvailable) return;

  // Roles must exist for registration to attach one. Idempotent.
  for (const name of ROLE_NAMES) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description: `${name} role`,
        isPrivileged: name !== 'CUSTOMER' && name !== 'EXPERT',
      },
    });
  }
});

afterAll(async () => {
  if (databaseAvailable && createdUserIds.length > 0) {
    // Cascades clean up sessions, tokens, profiles and backup codes.
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

/** Register, remember for cleanup, and return the user id plus verification token. */
async function register(
  name: string,
  accountType: 'CUSTOMER' | 'EXPERT' = 'CUSTOMER',
): Promise<{ userId: string; email: string; verificationToken: string }> {
  const email = emailFor(name);
  const result = await registerUser({
    email,
    password: STRONG_PASSWORD,
    fullName: `Test ${name}`,
    accountType,
  });
  expect(result.userId, 'registration should have created a user').toBeDefined();
  createdUserIds.push(result.userId!);
  return { userId: result.userId!, email, verificationToken: result.verificationToken! };
}

/** Register and verify, so the account is ACTIVE. */
async function registerActive(
  name: string,
  accountType: 'CUSTOMER' | 'EXPERT' = 'CUSTOMER',
): Promise<{ userId: string; email: string }> {
  const { userId, email, verificationToken } = await register(name, accountType);
  expect(await verifyEmail({ token: verificationToken })).toBe('VERIFIED');
  return { userId, email };
}

describe.skipIf(!databaseAvailable)('registration', () => {
  it('creates a pending user with a role, profile and verification token', async () => {
    const { userId, email } = await register('reg-customer', 'CUSTOMER');

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        email: true,
        status: true,
        emailVerified: true,
        passwordHash: true,
        customerProfile: { select: { id: true } },
        roles: { select: { role: { select: { name: true } } } },
        tokens: { select: { type: true, consumedAt: true } },
      },
    });

    expect(user.email).toBe(email);
    expect(user.status).toBe('PENDING_VERIFICATION');
    expect(user.emailVerified).toBeNull();
    expect(user.customerProfile).not.toBeNull();
    expect(user.roles.map((r) => r.role.name)).toEqual(['CUSTOMER']);
    expect(user.tokens).toHaveLength(1);
    expect(user.tokens[0]?.type).toBe('EMAIL_VERIFICATION');
  });

  it('stores an Argon2id hash, never the password', async () => {
    const { userId } = await register('reg-hash');
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    expect(user.passwordHash?.startsWith('$argon2id$')).toBe(true);
    expect(user.passwordHash).not.toContain(STRONG_PASSWORD);
  });

  it('creates an expert profile with a unique slug', async () => {
    const { userId } = await register('reg-expert', 'EXPERT');
    const profile = await prisma.expertProfile.findUniqueOrThrow({
      where: { userId },
      select: { slug: true },
    });
    expect(profile.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('does not reveal a duplicate email, and does not create a second account', async () => {
    const { email } = await register('reg-dupe');
    const before = await prisma.user.count({ where: { email } });

    const second = await registerUser({
      email,
      password: STRONG_PASSWORD,
      fullName: 'Impostor',
      accountType: 'CUSTOMER',
    });

    // Same shape as a success — no enumeration signal.
    expect(second.accepted).toBe(true);
    expect(second.userId).toBeUndefined();
    expect(await prisma.user.count({ where: { email } })).toBe(before);
  });
});

describe.skipIf(!databaseAvailable)('email verification', () => {
  it('activates the account and is single-use', async () => {
    const { userId, verificationToken } = await register('verify');

    expect(await verifyEmail({ token: verificationToken })).toBe('VERIFIED');
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { status: true, emailVerified: true },
    });
    expect(user.status).toBe('ACTIVE');
    expect(user.emailVerified).not.toBeNull();

    // Replaying the same link must not work twice.
    expect(await verifyEmail({ token: verificationToken })).toBe('ALREADY_VERIFIED');
  });

  it('rejects an unknown token', async () => {
    expect(await verifyEmail({ token: 'A'.repeat(43) })).toBe('INVALID_OR_EXPIRED');
  });

  it('rejects an expired token', async () => {
    const { verificationToken } = await register('verify-expired');
    await prisma.verificationToken.updateMany({
      where: { tokenHash: hashToken(verificationToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await verifyEmail({ token: verificationToken })).toBe('INVALID_OR_EXPIRED');
  });
});

describe.skipIf(!databaseAvailable)('login and sessions', () => {
  it('logs in and resolves a session into an actor', async () => {
    const { userId, email } = await registerActive('login-ok');

    const outcome = await login({ email, password: STRONG_PASSWORD });
    expect(outcome.result).toBe('SUCCESS');
    if (outcome.result !== 'SUCCESS') return;

    const resolved = await resolveSession(prisma, outcome.session.rawToken);
    expect(resolved).not.toBeNull();
    expect(resolved?.actor.userId).toBe(userId);
    expect(resolved?.actor.roles).toEqual(['CUSTOMER']);
    expect(resolved?.actor.accountActive).toBe(true);
    expect(resolved?.actor.mfaSatisfied).toBe(true); // no MFA enrolled
    expect(resolved?.mfaChallengePending).toBe(false);
  });

  it('stores only the session token digest', async () => {
    const { email } = await registerActive('login-digest');
    const outcome = await login({ email, password: STRONG_PASSWORD });
    if (outcome.result !== 'SUCCESS') throw new Error('expected success');

    const raw = outcome.session.rawToken;
    expect(await prisma.session.findUnique({ where: { sessionToken: raw } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { sessionToken: hashToken(raw) } }))
      .not.toBeNull();
  });

  it('authenticates an unverified account but authorization refuses it', async () => {
    const { email } = await register('login-unverified');
    const outcome = await login({ email, password: STRONG_PASSWORD });
    expect(outcome.result).toBe('SUCCESS');
    if (outcome.result !== 'SUCCESS') return;

    const resolved = await resolveSession(prisma, outcome.session.rawToken);
    expect(resolved?.actor.accountActive).toBe(false);
    expect(authorize(resolved!.actor, 'project:create:own', { customerUserId: resolved!.actor.userId }))
      .toEqual({ allowed: false, reason: 'ACCOUNT_INACTIVE' });
  });

  it('rejects a wrong password and an unknown email identically', async () => {
    const { email } = await registerActive('login-wrong');
    expect((await login({ email, password: 'wrong password here' })).result)
      .toBe('INVALID_CREDENTIALS');
    expect((await login({ email: emailFor('nobody'), password: STRONG_PASSWORD })).result)
      .toBe('INVALID_CREDENTIALS');
  });

  it('locks the account after repeated failures and clears on admin remediation', async () => {
    const { userId, email } = await registerActive('login-lockout');

    for (let attempt = 1; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
      expect((await login({ email, password: 'wrong' })).result).toBe('INVALID_CREDENTIALS');
    }
    // The threshold attempt locks it.
    expect((await login({ email, password: 'wrong' })).result).toBe('INVALID_CREDENTIALS');

    const locked = await login({ email, password: STRONG_PASSWORD });
    expect(locked.result).toBe('ACCOUNT_LOCKED');

    await clearLockout({ userId, actorUserId: userId });
    expect((await login({ email, password: STRONG_PASSWORD })).result).toBe('SUCCESS');
  });

  it('resets the failure counter on a successful login', async () => {
    const { userId, email } = await registerActive('login-counter');
    await login({ email, password: 'wrong' });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { failedLoginCount: true } }))
        .failedLoginCount,
    ).toBe(1);

    await login({ email, password: STRONG_PASSWORD });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { failedLoginCount: true } }))
        .failedLoginCount,
    ).toBe(0);
  });

  it('stops resolving a revoked session after logout', async () => {
    const { userId, email } = await registerActive('logout');
    const outcome = await login({ email, password: STRONG_PASSWORD });
    if (outcome.result !== 'SUCCESS') throw new Error('expected success');

    expect(await resolveSession(prisma, outcome.session.rawToken)).not.toBeNull();
    await logout({ sessionId: outcome.session.sessionId, userId });
    expect(await resolveSession(prisma, outcome.session.rawToken)).toBeNull();
  });

  it('stops resolving an expired session', async () => {
    const { email } = await registerActive('session-expiry');
    const outcome = await login({ email, password: STRONG_PASSWORD });
    if (outcome.result !== 'SUCCESS') throw new Error('expected success');

    await prisma.session.update({
      where: { id: outcome.session.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await resolveSession(prisma, outcome.session.rawToken)).toBeNull();
  });

  it('returns null for a token that was never issued', async () => {
    expect(await resolveSession(prisma, 'A'.repeat(43))).toBeNull();
  });
});

describe.skipIf(!databaseAvailable)('password reset and change', () => {
  it('resets the password, invalidates all sessions, and is single-use', async () => {
    const { email } = await registerActive('reset');

    const first = await login({ email, password: STRONG_PASSWORD });
    if (first.result !== 'SUCCESS') throw new Error('expected success');

    const request = await requestPasswordReset({ email });
    expect(request.resetToken).toBeDefined();

    const newPassword = 'a different long passphrase';
    expect(await resetPassword({ token: request.resetToken!, newPassword })).toBe('RESET');

    // Sessions minted before the reset are dead.
    expect(await resolveSession(prisma, first.session.rawToken)).toBeNull();
    // Old password no longer works; new one does.
    expect((await login({ email, password: STRONG_PASSWORD })).result).toBe('INVALID_CREDENTIALS');
    expect((await login({ email, password: newPassword })).result).toBe('SUCCESS');
    // Token cannot be replayed.
    expect(await resetPassword({ token: request.resetToken!, newPassword: 'yet another passphrase' }))
      .toBe('INVALID_OR_EXPIRED');
  });

  it('does not reveal whether an email exists', async () => {
    const unknown = await requestPasswordReset({ email: emailFor('ghost') });
    expect(unknown.accepted).toBe(true);
    expect(unknown.resetToken).toBeUndefined();
  });

  it('ignores a second reset request inside the cooldown, so the first link still works', async () => {
    // The cooldown exists because "forgot password" is unauthenticated and
    // takes only an address: without it, anyone can point our mail server at
    // somebody's inbox as fast as they can click. A suppressed request must be
    // a complete no-op — issuing nothing and invalidating nothing — or the
    // person is left holding a dead link and no replacement.
    const { email } = await registerActive('reset-cooldown');
    const first = await requestPasswordReset({ email });
    const second = await requestPasswordReset({ email });

    expect(second.resetToken).toBeUndefined();
    expect(await resetPassword({ token: first.resetToken!, newPassword: 'passphrase number one' }))
      .toBe('RESET');
  });

  it('invalidates an earlier reset link once the cooldown has passed', async () => {
    const { userId, email } = await registerActive('reset-supersede');
    const first = await requestPasswordReset({ email });

    // Backdate the outstanding token rather than sleeping a minute: the rule
    // under test is about elapsed time, not about wall-clock patience.
    await prisma.verificationToken.updateMany({
      where: { userId, type: 'PASSWORD_RESET', consumedAt: null },
      data: { createdAt: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS - 1000) },
    });

    const second = await requestPasswordReset({ email });
    expect(second.resetToken).toBeDefined();

    expect(await resetPassword({ token: first.resetToken!, newPassword: 'passphrase number one' }))
      .toBe('INVALID_OR_EXPIRED');
    expect(await resetPassword({ token: second.resetToken!, newPassword: 'passphrase number two' }))
      .toBe('RESET');
  });

  it('changes a password, keeping the acting session and revoking the others', async () => {
    const { userId, email } = await registerActive('change-pw');

    const keep = await login({ email, password: STRONG_PASSWORD });
    const other = await login({ email, password: STRONG_PASSWORD });
    if (keep.result !== 'SUCCESS' || other.result !== 'SUCCESS') throw new Error('expected success');

    const newPassword = 'brand new long passphrase';
    expect(
      await changePassword({
        userId,
        currentPassword: STRONG_PASSWORD,
        newPassword,
        currentSessionId: keep.session.sessionId,
      }),
    ).toBe('CHANGED');

    expect(await resolveSession(prisma, keep.session.rawToken)).not.toBeNull();
    expect(await resolveSession(prisma, other.session.rawToken)).toBeNull();
    expect((await login({ email, password: newPassword })).result).toBe('SUCCESS');
  });

  it('refuses a change without the correct current password', async () => {
    const { userId } = await registerActive('change-pw-wrong');
    expect(
      await changePassword({
        userId,
        currentPassword: 'not the password',
        newPassword: 'some other long passphrase',
      }),
    ).toBe('WRONG_PASSWORD');
  });
});

describe.skipIf(!databaseAvailable)('MFA', () => {
  it('enrolls in two phases and requires a valid code to enable', async () => {
    const { userId } = await registerActive('mfa-enroll');

    const start = await beginMfaEnrollment({ userId });
    expect(start?.secret).toBeDefined();
    expect(start?.otpauthUri.startsWith('otpauth://totp/')).toBe(true);

    // Not enabled until proven.
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabled: true } }))
        .mfaEnabled,
    ).toBe(false);

    expect((await confirmMfaEnrollment({ userId, code: '000000' })).result).toBe('INVALID_CODE');

    const code = await generateTotpCode(start!.secret);
    const confirmed = await confirmMfaEnrollment({ userId, code });
    expect(confirmed.result).toBe('ENABLED');
    if (confirmed.result !== 'ENABLED') return;
    expect(confirmed.backupCodes).toHaveLength(10);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaEnabled: true, mfaEnrolledAt: true },
    });
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaEnrolledAt).not.toBeNull();
    expect(await countUnusedBackupCodes(userId)).toBe(10);
  });

  it('withholds privileged access until the challenge is cleared', async () => {
    const { userId, email } = await registerActive('mfa-challenge');
    const start = await beginMfaEnrollment({ userId });
    await confirmMfaEnrollment({ userId, code: await generateTotpCode(start!.secret) });

    const outcome = await login({ email, password: STRONG_PASSWORD });
    expect(outcome.result).toBe('MFA_REQUIRED');
    if (outcome.result !== 'MFA_REQUIRED') return;

    const pending = await resolveSession(prisma, outcome.session.rawToken);
    expect(pending?.mfaChallengePending).toBe(true);
    expect(pending?.actor.mfaSatisfied).toBe(false);

    const satisfied = await verifyMfaChallenge({
      userId,
      sessionId: outcome.session.sessionId,
      code: await generateTotpCode(start!.secret),
    });
    expect(satisfied.result).toBe('SATISFIED');
    if (satisfied.result !== 'SATISFIED') return;

    // The token is reissued, because clearing MFA raises what the session may
    // do and a copy taken beforehand must not inherit that.
    expect(satisfied.rawToken).not.toBe(outcome.session.rawToken);
    expect(await resolveSession(prisma, outcome.session.rawToken)).toBeNull();

    const cleared = await resolveSession(prisma, satisfied.rawToken);
    expect(cleared?.sessionId).toBe(outcome.session.sessionId);
    expect(cleared?.actor.mfaSatisfied).toBe(true);
    expect(cleared?.mfaChallengePending).toBe(false);
  });

  it('rejects replay of an already-used TOTP code', async () => {
    const { userId, email } = await registerActive('mfa-replay');
    const start = await beginMfaEnrollment({ userId });
    await confirmMfaEnrollment({ userId, code: await generateTotpCode(start!.secret) });

    const outcome = await login({ email, password: STRONG_PASSWORD });
    if (outcome.result !== 'MFA_REQUIRED') throw new Error('expected MFA_REQUIRED');

    const code = await generateTotpCode(start!.secret);
    expect((await verifyMfaChallenge({ userId, sessionId: outcome.session.sessionId, code })).result)
      .toBe('SATISFIED');

    const second = await login({ email, password: STRONG_PASSWORD });
    if (second.result !== 'MFA_REQUIRED') throw new Error('expected MFA_REQUIRED');
    expect((await verifyMfaChallenge({ userId, sessionId: second.session.sessionId, code })).result)
      .toBe('INVALID');
  });

  it('accepts a backup code exactly once', async () => {
    const { userId, email } = await registerActive('mfa-backup');
    const start = await beginMfaEnrollment({ userId });
    const confirmed = await confirmMfaEnrollment({ userId, code: await generateTotpCode(start!.secret) });
    if (confirmed.result !== 'ENABLED') throw new Error('expected ENABLED');
    const backupCode = confirmed.backupCodes[0]!;

    const first = await login({ email, password: STRONG_PASSWORD });
    if (first.result !== 'MFA_REQUIRED') throw new Error('expected MFA_REQUIRED');
    const used = await verifyMfaChallenge({
      userId,
      sessionId: first.session.sessionId,
      backupCode,
    });
    expect(used).toMatchObject({ result: 'SATISFIED', usedBackupCode: true });
    if (used.result !== 'SATISFIED') return;
    // Rotated here too: a backup code clears the same gate a TOTP code does.
    expect(used.rawToken).not.toBe(first.session.rawToken);
    expect(await countUnusedBackupCodes(userId)).toBe(9);

    const second = await login({ email, password: STRONG_PASSWORD });
    if (second.result !== 'MFA_REQUIRED') throw new Error('expected MFA_REQUIRED');
    expect(
      (await verifyMfaChallenge({ userId, sessionId: second.session.sessionId, backupCode })).result,
    ).toBe('INVALID');
  });

  it('matches a backup code retyped in lower case without the dash', async () => {
    const { userId, email } = await registerActive('mfa-backup-format');
    const start = await beginMfaEnrollment({ userId });
    const confirmed = await confirmMfaEnrollment({ userId, code: await generateTotpCode(start!.secret) });
    if (confirmed.result !== 'ENABLED') throw new Error('expected ENABLED');

    const messy = confirmed.backupCodes[0]!.toLowerCase().replace('-', ' ');
    const outcome = await login({ email, password: STRONG_PASSWORD });
    if (outcome.result !== 'MFA_REQUIRED') throw new Error('expected MFA_REQUIRED');
    expect(
      (await verifyMfaChallenge({ userId, sessionId: outcome.session.sessionId, backupCode: messy }))
        .result,
    ).toBe('SATISFIED');
  });

  it('regenerates backup codes, invalidating the previous set', async () => {
    const { userId } = await registerActive('mfa-regen');
    const start = await beginMfaEnrollment({ userId });
    const confirmed = await confirmMfaEnrollment({ userId, code: await generateTotpCode(start!.secret) });
    if (confirmed.result !== 'ENABLED') throw new Error('expected ENABLED');

    const fresh = await regenerateBackupCodes({ userId });
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toEqual(confirmed.backupCodes);
    expect(await countUnusedBackupCodes(userId)).toBe(10);
  });

  it('revokes existing sessions when MFA is enabled', async () => {
    const { userId, email } = await registerActive('mfa-revoke');
    const before = await login({ email, password: STRONG_PASSWORD });
    if (before.result !== 'SUCCESS') throw new Error('expected success');

    const start = await beginMfaEnrollment({ userId });
    await confirmMfaEnrollment({ userId, code: await generateTotpCode(start!.secret) });

    expect(await resolveSession(prisma, before.session.rawToken)).toBeNull();
  });

  it('disables MFA for a non-privileged user given the password and a fresh code', async () => {
    const { userId } = await registerActive('mfa-disable');
    const start = await beginMfaEnrollment({ userId });
    await confirmMfaEnrollment({ userId, code: await generateTotpCode(start!.secret) });

    // Enrollment consumed the current time step, so reuse of that step is a
    // replay. A code one step ahead is inside the +/-1 window AND newer than the
    // consumed step, so it is the correct way to prove possession again.
    const nextStep = Math.floor(Date.now() / 1000) + 30;
    const freshCode = await generateTotpCode(start!.secret, nextStep);

    expect(await disableMfa({ userId, currentPassword: 'wrong password', code: freshCode }))
      .toBe('WRONG_PASSWORD');
    expect(await disableMfa({ userId, currentPassword: STRONG_PASSWORD, code: '000000' }))
      .toBe('INVALID_CODE');

    expect(await disableMfa({ userId, currentPassword: STRONG_PASSWORD, code: freshCode }))
      .toBe('DISABLED');

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaEnabled: true, mfaSecret: true, mfaEnrolledAt: true },
    });
    expect(user.mfaEnabled).toBe(false);
    expect(user.mfaSecret).toBeNull();
    expect(user.mfaEnrolledAt).toBeNull();
    expect(await countUnusedBackupCodes(userId)).toBe(0);
  });

  it('refuses to disable MFA for a user holding an MFA-required role', async () => {
    const { userId } = await registerActive('mfa-required-role');
    const start = await beginMfaEnrollment({ userId });
    await confirmMfaEnrollment({ userId, code: await generateTotpCode(start!.secret) });

    // Give the user FINANCE directly: this test is about the guard, not the
    // assignment path (which is covered separately).
    const finance = await prisma.role.findUniqueOrThrow({ where: { name: 'FINANCE' } });
    await prisma.userRole.create({ data: { userId, roleId: finance.id } });

    const freshCode = await generateTotpCode(start!.secret, Math.floor(Date.now() / 1000) + 30);
    expect(await disableMfa({ userId, currentPassword: STRONG_PASSWORD, code: freshCode }))
      .toBe('REQUIRED_BY_ROLE');

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabled: true } }))
        .mfaEnabled,
    ).toBe(true);
  });
});

describe.skipIf(!databaseAvailable)('role assignment (privilege escalation boundary)', () => {
  it('refuses assignment by a non-SUPER_ADMIN', async () => {
    const { userId: targetId } = await registerActive('role-target');
    const { userId: customerId } = await registerActive('role-customer');

    const customerActor = {
      userId: customerId,
      roles: ['CUSTOMER'] as const,
      mfaSatisfied: true,
      accountActive: true,
    };

    await expect(
      assignRole({ actor: customerActor, userId: targetId, role: 'ADMIN' }),
    ).rejects.toThrow(/Authorization denied/);

    expect(await rolesForUser(targetId)).toEqual(['CUSTOMER']);
  });

  it('refuses assignment by an ADMIN — only SUPER_ADMIN may escalate', async () => {
    const { userId: targetId } = await registerActive('role-target-2');
    const adminActor = {
      userId: '018f4f4e-0000-7000-8000-0000000000ad',
      roles: ['ADMIN'] as const,
      mfaSatisfied: true,
      accountActive: true,
    };
    await expect(assignRole({ actor: adminActor, userId: targetId, role: 'FINANCE' })).rejects
      .toThrow(/Authorization denied/);
  });

  it('refuses a SUPER_ADMIN who has not cleared MFA', async () => {
    const { userId: targetId } = await registerActive('role-target-3');
    const superNoMfa = {
      userId: '018f4f4e-0000-7000-8000-0000000000aa',
      roles: ['SUPER_ADMIN'] as const,
      mfaSatisfied: false,
      accountActive: true,
    };
    await expect(assignRole({ actor: superNoMfa, userId: targetId, role: 'FINANCE' })).rejects
      .toThrow(/MFA_REQUIRED/);
  });

  it('assigns a role, revokes the target sessions, and audits it as CRITICAL', async () => {
    const { userId: targetId, email } = await registerActive('role-assign');
    const { userId: superId } = await registerActive('role-super');

    const targetSession = await login({ email, password: STRONG_PASSWORD });
    if (targetSession.result !== 'SUCCESS') throw new Error('expected success');

    const superActor = {
      userId: superId,
      roles: ['SUPER_ADMIN'] as const,
      mfaSatisfied: true,
      accountActive: true,
    };

    expect(await assignRole({ actor: superActor, userId: targetId, role: 'FINANCE' }))
      .toBe('ASSIGNED');
    expect((await rolesForUser(targetId)).sort()).toEqual(['CUSTOMER', 'FINANCE']);

    // The target's session predates the privilege change and must be gone.
    expect(await resolveSession(prisma, targetSession.session.rawToken)).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: targetId, action: 'user.role.assigned' },
      select: { severity: true, actorUserId: true },
    });
    expect(audit?.severity).toBe('CRITICAL');
    expect(audit?.actorUserId).toBe(superId);
  });

  it('is idempotent on a repeat assignment', async () => {
    const { userId: targetId } = await registerActive('role-idem');
    const { userId: superId } = await registerActive('role-super-2');
    const superActor = {
      userId: superId,
      roles: ['SUPER_ADMIN'] as const,
      mfaSatisfied: true,
      accountActive: true,
    };

    expect(await assignRole({ actor: superActor, userId: targetId, role: 'SUPPORT' }))
      .toBe('ASSIGNED');
    expect(await assignRole({ actor: superActor, userId: targetId, role: 'SUPPORT' }))
      .toBe('ALREADY_ASSIGNED');
  });

  it('revokes a role and re-grants it without violating the unique constraint', async () => {
    const { userId: targetId } = await registerActive('role-revoke');
    const { userId: superId } = await registerActive('role-super-3');
    const superActor = {
      userId: superId,
      roles: ['SUPER_ADMIN'] as const,
      mfaSatisfied: true,
      accountActive: true,
    };

    await assignRole({ actor: superActor, userId: targetId, role: 'SUPPORT' });
    expect(await revokeRole({ actor: superActor, userId: targetId, role: 'SUPPORT' }))
      .toBe('REVOKED');
    expect(await rolesForUser(targetId)).toEqual(['CUSTOMER']);

    // Re-granting must reuse the revoked row.
    expect(await assignRole({ actor: superActor, userId: targetId, role: 'SUPPORT' }))
      .toBe('ASSIGNED');
    expect((await rolesForUser(targetId)).sort()).toEqual(['CUSTOMER', 'SUPPORT']);
  });

  it('reports NOT_ASSIGNED when revoking a role the user does not hold', async () => {
    const { userId: targetId } = await registerActive('role-none');
    const { userId: superId } = await registerActive('role-super-4');
    const superActor = {
      userId: superId,
      roles: ['SUPER_ADMIN'] as const,
      mfaSatisfied: true,
      accountActive: true,
    };
    expect(await revokeRole({ actor: superActor, userId: targetId, role: 'FINANCE' }))
      .toBe('NOT_ASSIGNED');
  });
});

describe.skipIf(!databaseAvailable)('audit trail', () => {
  it('records registration, login success, login failure and logout', async () => {
    const { userId, email } = await registerActive('audit');
    await login({ email, password: 'wrong' });
    const ok = await login({ email, password: STRONG_PASSWORD });
    if (ok.result !== 'SUCCESS') throw new Error('expected success');
    await logout({ sessionId: ok.session.sessionId, userId });

    const actions = await prisma.auditLog.findMany({
      where: { entityId: userId },
      select: { action: true },
    });
    const names = new Set(actions.map((a) => a.action));

    for (const expected of [
      'user.registered',
      'user.email.verified',
      'user.login.failed',
      'user.login.succeeded',
      'user.logged_out',
    ]) {
      expect(names, `missing audit action ${expected}`).toContain(expected);
    }
  });

  it('never writes a secret into the audit log', async () => {
    const { userId, email } = await registerActive('audit-redact');
    await login({ email, password: STRONG_PASSWORD });

    const entries = await prisma.auditLog.findMany({
      where: { entityId: userId },
      select: { beforeState: true, afterState: true },
    });

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(STRONG_PASSWORD);
    expect(serialized).not.toContain('$argon2id$');
  });

  it('carries request context through to the log', async () => {
    const { userId, email } = await registerActive('audit-context');
    await login({
      email,
      password: STRONG_PASSWORD,
      context: { ipAddress: '203.0.113.7', userAgent: 'vitest', requestId: 'req-abc-123' },
    });

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: userId, action: 'user.login.succeeded' },
      select: { ipAddress: true, userAgent: true, requestId: true },
    });
    expect(entry?.ipAddress).toBe('203.0.113.7');
    expect(entry?.requestId).toBe('req-abc-123');
  });
});

/**
 * TOTP multi-factor authentication.
 *
 * ENROLLMENT IS TWO-PHASE
 *   `beginMfaEnrollment` stores the secret but leaves `mfaEnabled` false.
 *   `confirmMfaEnrollment` requires a valid code before flipping it on. Without
 *   that proof, a user could lock themselves out of a privileged account with a
 *   secret their authenticator never actually received.
 *
 * REPLAY PROTECTION
 *   The highest consumed time step is persisted on the user, so an intercepted
 *   code cannot be reused inside its 30-second window.
 *
 * BACKUP CODES
 *   Single-use, stored as SHA-256 digests, and marked used rather than deleted so
 *   redemption stays auditable.
 *
 * BRUTE FORCE
 *   A six-digit code with a one-step window is three valid values in a million.
 *   Unlimited guesses turn that into a few hours of traffic, which would make
 *   the second factor decorative. Failures therefore count against the *same*
 *   lockout the password path uses (`failedLoginCount` / `lockedUntil` on the
 *   user row) — a failed second factor is a failed authentication attempt, and
 *   there is no reason for it to have a budget of its own. Counting on the user
 *   row keeps it durable and shared across instances; an in-process counter
 *   would be neither.
 */

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import { LOCKOUT_DURATION_MS, MAX_FAILED_LOGIN_ATTEMPTS } from './login-service';
import { verifyPassword } from '../../lib/auth/password';
import { generateBackupCodes, hashToken, normalizeBackupCode } from '../../lib/auth/tokens';
import { buildTotpUri, generateTotpSecret, verifyTotpCode } from '../../lib/auth/totp';
import { MFA_REQUIRED_ROLES, type RoleName } from '../../lib/authz/roles';
import { type Db, prisma } from '../../lib/db/client';
import { revokeAllSessions, rotateSession } from './session-service';

export interface MfaEnrollmentStart {
  readonly secret: string;
  /** Render as a QR code for the authenticator app. */
  readonly otpauthUri: string;
}

/** Phase 1: generate and store a secret. MFA is not yet active. */
export async function beginMfaEnrollment(
  params: { userId: string; issuer?: string; context?: RequestContext },
  db: Db = prisma,
): Promise<MfaEnrollmentStart | null> {
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { id: true, email: true, mfaEnabled: true },
  });
  if (!user || user.mfaEnabled) return null;

  const secret = await generateTotpSecret();

  await db.user.update({
    where: { id: user.id },
    data: { mfaSecret: secret, mfaLastUsedTimeStep: null },
  });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.MFA_ENROLLMENT_STARTED,
    entityType: 'User',
    entityId: user.id,
    actorUserId: user.id,
    severity: 'NOTICE',
    ...params.context,
  });

  return {
    secret,
    otpauthUri: await buildTotpUri({
      secret,
      label: user.email,
      issuer: params.issuer ?? 'Talent Marketplace',
    }),
  };
}

export type ConfirmMfaOutcome =
  | { readonly result: 'ENABLED'; readonly backupCodes: readonly string[] }
  | { readonly result: 'INVALID_CODE' }
  | { readonly result: 'NOT_ENROLLING' };

/** Phase 2: prove possession of the secret, then enable MFA and issue backup codes. */
export async function confirmMfaEnrollment(
  params: { userId: string; code: string; context?: RequestContext },
  db: Db = prisma,
): Promise<ConfirmMfaOutcome> {
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { id: true, mfaSecret: true, mfaEnabled: true },
  });
  if (!user?.mfaSecret || user.mfaEnabled) return { result: 'NOT_ENROLLING' };

  const verification = await verifyTotpCode({ secret: user.mfaSecret, code: params.code });
  if (!verification.valid) return { result: 'INVALID_CODE' };

  const codes = generateBackupCodes();

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        mfaEnrolledAt: new Date(),
        // Deliberately NOT recording this step as consumed. Enabling MFA revokes
        // all sessions, so the user must immediately log in again — and their
        // authenticator is still showing the same code. Consuming the step here
        // would reject that code and strand them for up to 30 seconds with no
        // explanation. Replay protection belongs on the challenge path, which is
        // where an intercepted code could actually be reused to authenticate.
        mfaLastUsedTimeStep: null,
      },
    });

    // Replace any codes from an earlier enrollment.
    await tx.mfaBackupCode.deleteMany({ where: { userId: user.id } });
    await tx.mfaBackupCode.createMany({
      data: codes.hashes.map((codeHash) => ({ userId: user.id, codeHash })),
    });

    // Enabling MFA is a privilege change: existing sessions predate it.
    await revokeAllSessions(tx, {
      userId: user.id,
      reason: 'mfa_enabled',
      actorUserId: user.id,
      ...(params.context ? { context: params.context } : {}),
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.MFA_ENABLED,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      severity: 'NOTICE',
      ...params.context,
    });
  });

  return { result: 'ENABLED', backupCodes: codes.raw };
}

export type MfaChallengeOutcome =
  | {
      readonly result: 'SATISFIED';
      readonly usedBackupCode: boolean;
      /**
       * A new raw session token. Clearing MFA raises what the session can do,
       * so the token that identifies it is reissued — see `rotateSession`.
       * The caller must put this in the cookie or the person is signed out.
       */
      readonly rawToken: string;
      readonly expiresAt: Date;
    }
  | { readonly result: 'INVALID' }
  /** Too many failed attempts; the same lockout the password path uses. */
  | { readonly result: 'LOCKED'; readonly lockedUntil: Date }
  | { readonly result: 'MFA_NOT_ENABLED' };

/**
 * Complete the MFA challenge for a session, with either a TOTP code or a single
 * backup code. Exactly one should be supplied.
 */
export async function verifyMfaChallenge(
  params: {
    userId: string;
    sessionId: string;
    code?: string | undefined;
    backupCode?: string | undefined;
    context?: RequestContext;
  },
  db: Db = prisma,
): Promise<MfaChallengeOutcome> {
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      mfaEnabled: true,
      mfaSecret: true,
      mfaLastUsedTimeStep: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  });
  if (!user?.mfaEnabled || !user.mfaSecret) return { result: 'MFA_NOT_ENABLED' };

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    await writeAudit(db, {
      action: AUDIT_ACTIONS.MFA_CHALLENGE_FAILED,
      entityType: 'User',
      entityId: user.id,
      actorType: 'SYSTEM',
      severity: 'WARNING',
      afterState: { reason: 'account_locked', lockedUntil: user.lockedUntil.toISOString() },
      ...params.context,
    });
    return { result: 'LOCKED', lockedUntil: user.lockedUntil };
  }

  /** Count this failure, and lock the account once the budget is spent. */
  const countFailure = async (method: 'totp' | 'backup_code'): Promise<MfaChallengeOutcome> => {
    const failedCount = user.failedLoginCount + 1;
    const shouldLock = failedCount >= MAX_FAILED_LOGIN_ATTEMPTS;

    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failedCount,
        lockedUntil: shouldLock ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : null,
      },
    });

    await writeAudit(db, {
      action: AUDIT_ACTIONS.MFA_CHALLENGE_FAILED,
      entityType: 'User',
      entityId: user.id,
      actorType: 'SYSTEM',
      severity: shouldLock ? 'WARNING' : 'NOTICE',
      afterState: { method, failedLoginCount: failedCount, locked: shouldLock },
      ...params.context,
    });

    return shouldLock
      ? { result: 'LOCKED', lockedUntil: new Date(now.getTime() + LOCKOUT_DURATION_MS) }
      : { result: 'INVALID' };
  };

  if (params.backupCode) {
    const codeHash = hashToken(normalizeBackupCode(params.backupCode));

    // Conditional update: a code can only be redeemed once, even under a race.
    const redeemed = await db.mfaBackupCode.updateMany({
      where: { userId: user.id, codeHash, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (redeemed.count === 0) return countFailure('backup_code');

    const rotated = await rotateSession(db, {
      sessionId: params.sessionId,
      mfaSatisfied: true,
      ...(params.context ? { context: params.context } : {}),
    });
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    await writeAudit(db, {
      action: AUDIT_ACTIONS.MFA_BACKUP_CODE_USED,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      severity: 'WARNING',
      ...params.context,
    });
    return {
      result: 'SATISFIED',
      usedBackupCode: true,
      rawToken: rotated.rawToken,
      expiresAt: rotated.expiresAt,
    };
  }

  if (!params.code) return countFailure('totp');

  const verification = await verifyTotpCode({
    secret: user.mfaSecret,
    code: params.code,
    lastUsedTimeStep: user.mfaLastUsedTimeStep,
  });

  if (!verification.valid) return countFailure('totp');

  const rotated = await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        mfaLastUsedTimeStep: verification.timeStep,
        // A cleared challenge is a successful authentication, so it clears the
        // counter the same way a correct password does.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    const next = await rotateSession(tx, {
      sessionId: params.sessionId,
      mfaSatisfied: true,
      ...(params.context ? { context: params.context } : {}),
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.MFA_CHALLENGE_SUCCEEDED,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      ...params.context,
    });
    return next;
  });

  return {
    result: 'SATISFIED',
    usedBackupCode: false,
    rawToken: rotated.rawToken,
    expiresAt: rotated.expiresAt,
  };
}

export type DisableMfaOutcome =
  | 'DISABLED'
  | 'WRONG_PASSWORD'
  | 'INVALID_CODE'
  | 'MFA_NOT_ENABLED'
  | 'REQUIRED_BY_ROLE';

/**
 * Disable MFA. Requires both the password and a valid code.
 *
 * Refused outright for a user holding an MFA-required role — otherwise a
 * privileged account could downgrade its own security, and `authorize` would
 * then let it act with no second factor.
 */
export async function disableMfa(
  params: { userId: string; currentPassword: string; code: string; context?: RequestContext },
  db: Db = prisma,
): Promise<DisableMfaOutcome> {
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      passwordHash: true,
      mfaEnabled: true,
      mfaSecret: true,
      mfaLastUsedTimeStep: true,
      roles: { where: { revokedAt: null }, select: { role: { select: { name: true } } } },
    },
  });
  if (!user?.mfaEnabled || !user.mfaSecret) return 'MFA_NOT_ENABLED';

  const roles = user.roles.map((link) => link.role.name as RoleName);
  if (roles.some((role) => MFA_REQUIRED_ROLES.includes(role))) {
    return 'REQUIRED_BY_ROLE';
  }

  if (!(await verifyPassword(user.passwordHash, params.currentPassword))) {
    return 'WRONG_PASSWORD';
  }

  const verification = await verifyTotpCode({
    secret: user.mfaSecret,
    code: params.code,
    lastUsedTimeStep: user.mfaLastUsedTimeStep,
  });
  if (!verification.valid) return 'INVALID_CODE';

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaEnrolledAt: null,
        mfaLastUsedTimeStep: null,
      },
    });
    await tx.mfaBackupCode.deleteMany({ where: { userId: user.id } });
    await revokeAllSessions(tx, {
      userId: user.id,
      reason: 'mfa_disabled',
      actorUserId: user.id,
      ...(params.context ? { context: params.context } : {}),
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.MFA_DISABLED,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      severity: 'WARNING',
      ...params.context,
    });
  });

  return 'DISABLED';
}

/** Issue a fresh set of backup codes, invalidating the previous set. */
export async function regenerateBackupCodes(
  params: { userId: string; context?: RequestContext },
  db: Db = prisma,
): Promise<readonly string[] | null> {
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { id: true, mfaEnabled: true },
  });
  if (!user?.mfaEnabled) return null;

  const codes = generateBackupCodes();

  await db.$transaction(async (tx) => {
    await tx.mfaBackupCode.deleteMany({ where: { userId: user.id } });
    await tx.mfaBackupCode.createMany({
      data: codes.hashes.map((codeHash) => ({ userId: user.id, codeHash })),
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.MFA_BACKUP_CODES_REGENERATED,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      severity: 'NOTICE',
      ...params.context,
    });
  });

  return codes.raw;
}

/** Remaining unused backup codes, for the security settings screen. */
export async function countUnusedBackupCodes(userId: string, db: Db = prisma): Promise<number> {
  return db.mfaBackupCode.count({ where: { userId, usedAt: null } });
}

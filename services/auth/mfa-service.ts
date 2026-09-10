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
 */

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import { verifyPassword } from '../../lib/auth/password';
import { generateBackupCodes, hashToken, normalizeBackupCode } from '../../lib/auth/tokens';
import { buildTotpUri, generateTotpSecret, verifyTotpCode } from '../../lib/auth/totp';
import { MFA_REQUIRED_ROLES, type RoleName } from '../../lib/authz/roles';
import { type Db, prisma } from '../../lib/db/client';
import { markSessionMfaSatisfied, revokeAllSessions } from './session-service';

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
  | { readonly result: 'SATISFIED'; readonly usedBackupCode: boolean }
  | { readonly result: 'INVALID' }
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
    select: { id: true, mfaEnabled: true, mfaSecret: true, mfaLastUsedTimeStep: true },
  });
  if (!user?.mfaEnabled || !user.mfaSecret) return { result: 'MFA_NOT_ENABLED' };

  if (params.backupCode) {
    const codeHash = hashToken(normalizeBackupCode(params.backupCode));

    // Conditional update: a code can only be redeemed once, even under a race.
    const redeemed = await db.mfaBackupCode.updateMany({
      where: { userId: user.id, codeHash, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (redeemed.count === 0) {
      await writeAudit(db, {
        action: AUDIT_ACTIONS.MFA_CHALLENGE_FAILED,
        entityType: 'User',
        entityId: user.id,
        actorType: 'SYSTEM',
        severity: 'WARNING',
        afterState: { method: 'backup_code' },
        ...params.context,
      });
      return { result: 'INVALID' };
    }

    await markSessionMfaSatisfied(db, params.sessionId);
    await writeAudit(db, {
      action: AUDIT_ACTIONS.MFA_BACKUP_CODE_USED,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      severity: 'WARNING',
      ...params.context,
    });
    return { result: 'SATISFIED', usedBackupCode: true };
  }

  if (!params.code) return { result: 'INVALID' };

  const verification = await verifyTotpCode({
    secret: user.mfaSecret,
    code: params.code,
    lastUsedTimeStep: user.mfaLastUsedTimeStep,
  });

  if (!verification.valid) {
    await writeAudit(db, {
      action: AUDIT_ACTIONS.MFA_CHALLENGE_FAILED,
      entityType: 'User',
      entityId: user.id,
      actorType: 'SYSTEM',
      severity: 'WARNING',
      afterState: { method: 'totp' },
      ...params.context,
    });
    return { result: 'INVALID' };
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { mfaLastUsedTimeStep: verification.timeStep },
    });
    await markSessionMfaSatisfied(tx, params.sessionId);
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.MFA_CHALLENGE_SUCCEEDED,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      ...params.context,
    });
  });

  return { result: 'SATISFIED', usedBackupCode: false };
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

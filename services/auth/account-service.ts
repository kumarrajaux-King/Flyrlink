/**
 * Account lifecycle: registration, email verification, password reset, password change.
 *
 * ENUMERATION POLICY
 *   Registration and password-reset requests return the same result whether or
 *   not the email is already registered. An attacker cannot use either endpoint
 *   to discover who has an account. The real signal reaches the genuine owner by
 *   email (either "verify your address" or "someone tried to register your
 *   address"), which is the only channel that proves control of the mailbox.
 *
 * ROLE POLICY
 *   Registration may only ever grant CUSTOMER or EXPERT. Privileged roles are
 *   assigned exclusively through `role-service`, which is SUPER_ADMIN-gated and
 *   audited. There is no code path here that can grant one.
 */

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import { hashPassword, verifyPassword } from '../../lib/auth/password';
import {
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  expiresAt,
  hashToken,
  isExpired,
  issueToken,
} from '../../lib/auth/tokens';
import { type Db, prisma } from '../../lib/db/client';
import { revokeAllSessions } from './session-service';

export type SelfServiceAccountType = 'CUSTOMER' | 'EXPERT';

export interface RegisterParams {
  email: string;
  password: string;
  fullName: string;
  accountType: SelfServiceAccountType;
  context?: RequestContext;
}

export interface RegisterResult {
  /**
   * Always true — the caller shows "check your email" regardless, so the
   * response cannot be used to enumerate accounts.
   */
  readonly accepted: true;
  /** Present only when a new account was actually created. */
  readonly userId?: string;
  /**
   * Raw verification token, to be emailed. Never returned to the browser.
   * Absent when no account was created.
   */
  readonly verificationToken?: string;
}

/** Build a unique, URL-safe slug for an expert profile from their name. */
async function uniqueExpertSlug(db: Db, fullName: string): Promise<string> {
  const base =
    fullName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'expert';

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await db.expertProfile.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  // Fall back to something guaranteed unique rather than looping forever.
  return `${base}-${Date.now().toString(36)}`;
}

export async function registerUser(
  params: RegisterParams,
  db: Db = prisma,
): Promise<RegisterResult> {
  const email = params.email.trim().toLowerCase();

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    // Do not create, do not reveal. Record the attempt so repeated probing is
    // visible to operators in the audit log.
    await writeAudit(db, {
      action: AUDIT_ACTIONS.USER_REGISTERED,
      entityType: 'User',
      entityId: existing.id,
      actorType: 'SYSTEM',
      severity: 'NOTICE',
      afterState: { outcome: 'duplicate_email_ignored' },
      ...params.context,
    });
    return { accepted: true };
  }

  const passwordHash = await hashPassword(params.password);
  const verification = issueToken();

  const userId = await db.$transaction(async (tx) => {
    const role = await tx.role.findUnique({
      where: { name: params.accountType },
      select: { id: true },
    });
    if (!role) {
      throw new Error(`Role ${params.accountType} is not seeded.`);
    }

    const user = await tx.user.create({
      data: {
        email,
        fullName: params.fullName.trim(),
        passwordHash,
        status: 'PENDING_VERIFICATION',
        roles: { create: { roleId: role.id } },
      },
      select: { id: true },
    });

    if (params.accountType === 'CUSTOMER') {
      await tx.customerProfile.create({ data: { userId: user.id } });
    } else {
      await tx.expertProfile.create({
        data: { userId: user.id, slug: await uniqueExpertSlug(tx, params.fullName) },
      });
    }

    await tx.verificationToken.create({
      data: {
        userId: user.id,
        identifier: email,
        tokenHash: verification.hash,
        type: 'EMAIL_VERIFICATION',
        expiresAt: expiresAt(EMAIL_VERIFICATION_TTL_MS),
      },
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.USER_REGISTERED,
      entityType: 'User',
      entityId: user.id,
      actorType: 'SYSTEM',
      afterState: { email, accountType: params.accountType },
      ...params.context,
    });

    return user.id;
  });

  return { accepted: true, userId, verificationToken: verification.raw };
}

/**
 * How long a freshly issued verification or reset email suppresses the next one.
 *
 * Without this, "resend" is an email cannon: anyone who knows an address can
 * point it at that inbox as fast as they can click, and the mail lands from us.
 * A minute is long enough to make that pointless and short enough that somebody
 * who genuinely lost the first mail is not stuck.
 *
 * Enforced off the last unconsumed token's `createdAt`, so it is durable and
 * shared across instances — the same reasoning as account lockout, and for the
 * same reason as there, no in-process counter would do.
 */
export const VERIFICATION_RESEND_COOLDOWN_MS = 1000 * 60;

export type VerifyEmailOutcome = 'VERIFIED' | 'ALREADY_VERIFIED' | 'INVALID_OR_EXPIRED';

/** Consume an email-verification token and promote the account to ACTIVE. */
export async function verifyEmail(
  params: { token: string; context?: RequestContext },
  db: Db = prisma,
): Promise<VerifyEmailOutcome> {
  const tokenHash = hashToken(params.token);

  const record = await db.verificationToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      consumedAt: true,
      type: true,
      user: { select: { emailVerified: true } },
    },
  });

  if (!record || record.type !== 'EMAIL_VERIFICATION' || !record.userId) {
    return 'INVALID_OR_EXPIRED';
  }

  /*
   * "Already verified" is a fact about the ACCOUNT, not about the token.
   *
   * Reading it off `consumedAt` was wrong in two ways. A token is also
   * consumed when it is superseded — `resendVerification` retires the
   * outstanding links so only the newest works — and the old link then
   * answered "already verified" to somebody whose account was still
   * PENDING_VERIFICATION, who would go and try to sign in and get nowhere. It
   * also mislabelled the rare case where the token was consumed by a race but
   * the account update did not land.
   */
  if (record.consumedAt) {
    return record.user?.emailVerified ? 'ALREADY_VERIFIED' : 'INVALID_OR_EXPIRED';
  }
  if (isExpired(record.expiresAt)) return 'INVALID_OR_EXPIRED';

  await db.$transaction(async (tx) => {
    // Single-use: the conditional update means a concurrent second request
    // cannot consume the same token twice.
    const consumed = await tx.verificationToken.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) return;

    await tx.user.update({
      where: { id: record.userId! },
      data: { emailVerified: new Date(), status: 'ACTIVE' },
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.USER_EMAIL_VERIFIED,
      entityType: 'User',
      entityId: record.userId,
      actorUserId: record.userId,
      afterState: { status: 'ACTIVE' },
      ...params.context,
    });
  });

  return 'VERIFIED';
}

export interface ResendVerificationResult {
  /** Always true — the response never reveals whether the email is registered. */
  readonly accepted: true;
  /** Raw token to email. Absent when there is nothing to send. */
  readonly verificationToken?: string;
}

/**
 * Issue a fresh verification link.
 *
 * A verification token lives 24 hours. Before this existed, letting one lapse
 * was a dead end: the account could not sign in, and nothing in the product
 * could issue another. Registering again fails on the unique email.
 *
 * Says nothing either way. No account, an already-verified one, and a
 * cooled-down resend are indistinguishable from the caller's side — the same
 * enumeration rule the rest of this module follows.
 */
export async function resendVerification(
  params: { email: string; context?: RequestContext },
  db: Db = prisma,
): Promise<ResendVerificationResult> {
  const email = params.email.trim().toLowerCase();

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true, emailVerified: true },
  });
  // Nothing to do, and nothing to say: no account, deleted, or already through.
  if (!user || user.deletedAt || user.emailVerified) return { accepted: true };

  const recent = await db.verificationToken.findFirst({
    where: {
      userId: user.id,
      type: 'EMAIL_VERIFICATION',
      consumedAt: null,
      createdAt: { gt: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (recent) return { accepted: true };

  const token = issueToken();

  await db.$transaction(async (tx) => {
    // Retire the outstanding links. Two live verification links for one address
    // is one more than anybody needs, and the older one is the one an attacker
    // would have had time to intercept.
    await tx.verificationToken.updateMany({
      where: { userId: user.id, type: 'EMAIL_VERIFICATION', consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await tx.verificationToken.create({
      data: {
        userId: user.id,
        identifier: email,
        tokenHash: token.hash,
        type: 'EMAIL_VERIFICATION',
        expiresAt: expiresAt(EMAIL_VERIFICATION_TTL_MS),
      },
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.USER_EMAIL_VERIFICATION_RESENT,
      entityType: 'User',
      entityId: user.id,
      actorType: 'SYSTEM',
      severity: 'NOTICE',
      ...params.context,
    });
  });

  return { accepted: true, verificationToken: token.raw };
}

export interface PasswordResetRequestResult {
  /** Always true — the response never reveals whether the email is registered. */
  readonly accepted: true;
  /** Raw token to email. Absent when no matching account exists. */
  readonly resetToken?: string;
}

export async function requestPasswordReset(
  params: { email: string; context?: RequestContext },
  db: Db = prisma,
): Promise<PasswordResetRequestResult> {
  const email = params.email.trim().toLowerCase();
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true },
  });

  if (!user || user.deletedAt) {
    return { accepted: true };
  }

  // Same cooldown as verification, and for the same reason: "forgot password"
  // is unauthenticated and takes only an address, so without one it is a way to
  // bombard somebody's inbox with mail that genuinely came from us.
  const recent = await db.verificationToken.findFirst({
    where: {
      userId: user.id,
      type: 'PASSWORD_RESET',
      consumedAt: null,
      createdAt: { gt: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (recent) return { accepted: true };

  const token = issueToken();

  await db.$transaction(async (tx) => {
    // Invalidate any outstanding reset tokens, so only the newest link works.
    await tx.verificationToken.updateMany({
      where: { userId: user.id, type: 'PASSWORD_RESET', consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await tx.verificationToken.create({
      data: {
        userId: user.id,
        identifier: email,
        tokenHash: token.hash,
        type: 'PASSWORD_RESET',
        expiresAt: expiresAt(PASSWORD_RESET_TTL_MS),
      },
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
      entityType: 'User',
      entityId: user.id,
      actorType: 'SYSTEM',
      severity: 'NOTICE',
      ...params.context,
    });
  });

  return { accepted: true, resetToken: token.raw };
}

export type ResetPasswordOutcome = 'RESET' | 'INVALID_OR_EXPIRED';

/**
 * Complete a password reset.
 *
 * On success every session is revoked: a reset is the recovery path for a
 * compromised account, so any session an attacker holds must die with it.
 */
export async function resetPassword(
  params: { token: string; newPassword: string; context?: RequestContext },
  db: Db = prisma,
): Promise<ResetPasswordOutcome> {
  const tokenHash = hashToken(params.token);

  const record = await db.verificationToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, consumedAt: true, type: true },
  });

  if (!record || record.type !== 'PASSWORD_RESET' || !record.userId) return 'INVALID_OR_EXPIRED';
  if (record.consumedAt || isExpired(record.expiresAt)) return 'INVALID_OR_EXPIRED';

  const passwordHash = await hashPassword(params.newPassword);
  const userId = record.userId;

  const applied = await db.$transaction(async (tx) => {
    const consumed = await tx.verificationToken.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) return false;

    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });

    await revokeAllSessions(tx, {
      userId,
      reason: 'password_reset',
      actorUserId: userId,
      ...(params.context ? { context: params.context } : {}),
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
      entityType: 'User',
      entityId: userId,
      actorUserId: userId,
      severity: 'NOTICE',
      ...params.context,
    });

    return true;
  });

  return applied ? 'RESET' : 'INVALID_OR_EXPIRED';
}

export type ChangePasswordOutcome = 'CHANGED' | 'WRONG_PASSWORD' | 'USER_NOT_FOUND';

/**
 * Change a password for a signed-in user.
 *
 * Requires the current password (so a stolen session alone cannot lock the owner
 * out) and revokes every *other* session, leaving the acting one alive.
 */
export async function changePassword(
  params: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    /** Keep this session alive; revoke the rest. */
    currentSessionId?: string | null;
    context?: RequestContext;
  },
  db: Db = prisma,
): Promise<ChangePasswordOutcome> {
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { id: true, passwordHash: true },
  });
  if (!user) return 'USER_NOT_FOUND';

  if (!(await verifyPassword(user.passwordHash, params.currentPassword))) {
    return 'WRONG_PASSWORD';
  }

  const passwordHash = await hashPassword(params.newPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });

    await revokeAllSessions(tx, {
      userId: user.id,
      exceptSessionId: params.currentSessionId ?? null,
      reason: 'password_changed',
      actorUserId: user.id,
      ...(params.context ? { context: params.context } : {}),
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      severity: 'NOTICE',
      ...params.context,
    });
  });

  return 'CHANGED';
}

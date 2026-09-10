/**
 * Session lifecycle.
 *
 * SECURITY MODEL
 *   - The raw session token exists only in the client's httpOnly cookie. The
 *     database stores its SHA-256 digest, so a database leak yields no usable
 *     sessions.
 *   - `mfaSatisfied` lives on the session, not the user. A user with MFA enabled
 *     gets a session that is authenticated but not yet MFA-cleared; `authorize`
 *     denies privileged work until the challenge is passed. That is what makes
 *     MFA a property of *this* login rather than of the account.
 *   - Any privilege change (password, MFA, roles) revokes every other session,
 *     so a stolen session cannot outlive the credential it was minted from.
 */

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import { SESSION_TTL_MS, expiresAt, hashToken, issueToken } from '../../lib/auth/tokens';
import { type Actor } from '../../lib/authz/authorize';
import { type RoleName } from '../../lib/authz/roles';
import { type Db, prisma } from '../../lib/db/client';

export interface CreatedSession {
  /** Give this to the client in an httpOnly cookie. It is never stored raw. */
  readonly rawToken: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
  /** False when the user has MFA enabled and has not yet cleared the challenge. */
  readonly mfaSatisfied: boolean;
}

/** Create a session for a user who has already proven their password. */
export async function createSession(
  db: Db,
  params: {
    userId: string;
    /** Pass false when the user has MFA enabled — the challenge sets it true. */
    mfaSatisfied: boolean;
    context?: RequestContext;
  },
): Promise<CreatedSession> {
  const { raw, hash } = issueToken();
  const expiry = expiresAt(SESSION_TTL_MS);

  const session = await db.session.create({
    data: {
      userId: params.userId,
      sessionToken: hash,
      expiresAt: expiry,
      mfaSatisfied: params.mfaSatisfied,
      ipAddress: params.context?.ipAddress ?? null,
      userAgent: params.context?.userAgent ?? null,
    },
    select: { id: true },
  });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.SESSION_CREATED,
    entityType: 'Session',
    entityId: session.id,
    actorUserId: params.userId,
    afterState: { mfaSatisfied: params.mfaSatisfied },
    ...params.context,
  });

  return {
    rawToken: raw,
    sessionId: session.id,
    expiresAt: expiry,
    mfaSatisfied: params.mfaSatisfied,
  };
}

export interface ResolvedSession {
  readonly sessionId: string;
  readonly actor: Actor;
  readonly expiresAt: Date;
  /** True when the user has MFA enabled but this session has not cleared it. */
  readonly mfaChallengePending: boolean;
}

/**
 * Resolve a raw session token into an `Actor`.
 *
 * Returns null for an unknown, revoked or expired token. The lookup is by digest
 * so it stays a single indexed equality match.
 *
 * The returned `Actor` is assembled entirely from the database. Nothing about
 * roles, account status or MFA state comes from client input — that is the
 * "never trust the client" rule made structural.
 */
export async function resolveSession(
  db: Db,
  rawToken: string,
  now: Date = new Date(),
): Promise<ResolvedSession | null> {
  const session = await db.session.findUnique({
    where: { sessionToken: hashToken(rawToken) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      mfaSatisfied: true,
      user: {
        select: {
          id: true,
          status: true,
          deletedAt: true,
          mfaEnabled: true,
          roles: {
            where: { revokedAt: null },
            select: { role: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= now.getTime()) return null;
  if (session.user.deletedAt) return null;

  const roles = session.user.roles.map((link) => link.role.name as RoleName);

  return {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    mfaChallengePending: session.user.mfaEnabled && !session.mfaSatisfied,
    actor: {
      userId: session.user.id,
      roles,
      mfaSatisfied: session.mfaSatisfied,
      // Only an ACTIVE account may act. A registered-but-unverified or a
      // suspended user authenticates successfully and is then refused by
      // `authorize` with ACCOUNT_INACTIVE, which is a clearer signal than a
      // blanket login failure.
      accountActive: session.user.status === 'ACTIVE',
    },
  };
}

/** Mark a session as having cleared the MFA challenge. */
export async function markSessionMfaSatisfied(db: Db, sessionId: string): Promise<void> {
  await db.session.update({
    where: { id: sessionId },
    data: { mfaSatisfied: true },
  });
}

/** Revoke a single session (logout). Idempotent. */
export async function revokeSession(
  db: Db,
  params: { sessionId: string; actorUserId?: string | null; context?: RequestContext },
): Promise<void> {
  await db.session.updateMany({
    where: { id: params.sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.SESSION_REVOKED,
    entityType: 'Session',
    entityId: params.sessionId,
    actorUserId: params.actorUserId ?? null,
    ...params.context,
  });
}

/**
 * Revoke every session for a user, optionally keeping one.
 *
 * Called on password change, MFA enable/disable and role change. `exceptSessionId`
 * lets the acting session survive its own privilege change so the user is not
 * logged out by changing their own password.
 */
export async function revokeAllSessions(
  db: Db,
  params: {
    userId: string;
    exceptSessionId?: string | null;
    reason: string;
    actorUserId?: string | null;
    context?: RequestContext;
  },
): Promise<number> {
  const result = await db.session.updateMany({
    where: {
      userId: params.userId,
      revokedAt: null,
      ...(params.exceptSessionId ? { id: { not: params.exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.SESSIONS_REVOKED_ALL,
    entityType: 'User',
    entityId: params.userId,
    actorUserId: params.actorUserId ?? params.userId,
    severity: 'NOTICE',
    afterState: { revokedCount: result.count, reason: params.reason },
    ...params.context,
  });

  return result.count;
}

/** Remove expired and long-revoked sessions. Intended for a scheduled job. */
export async function pruneSessions(
  db: Db = prisma,
  now: Date = new Date(),
): Promise<number> {
  const result = await db.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: now } }] },
  });
  return result.count;
}

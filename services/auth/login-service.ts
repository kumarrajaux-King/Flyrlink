/**
 * Login, lockout and logout.
 *
 * BRUTE-FORCE POLICY
 *   Failed attempts are counted on the user row and the account locks for a
 *   cooling-off period after a threshold. This is durable and shared across
 *   application instances, unlike in-process counters.
 *
 *   IP-level throttling is deliberately NOT implemented here: it needs shared
 *   state across instances (Redis), which STEP 02 §17 places in the scale tier.
 *   Account lockout is the control that actually protects an individual account
 *   from credential stuffing; distributed IP throttling is defence in depth and
 *   is tracked for Phase 13.
 *
 * MFA POLICY
 *   A session is minted MFA-cleared only when there is genuinely nothing to
 *   clear. Holding a role in `MFA_REQUIRED_ROLES` is enough to withhold that on
 *   its own, even from an account that never enrolled a second factor: the
 *   alternative is that "no MFA configured" reads as "no MFA outstanding" and
 *   an administrator who skipped enrollment gets a fully privileged session.
 *   `authorize` then refuses every privileged permission until they enrol and
 *   pass a challenge, and `resolveSession` re-derives the same conclusion on
 *   every request so this is not the only place it is enforced.
 *
 * ENUMERATION POLICY
 *   Every failure path returns the same `INVALID_CREDENTIALS` outcome and costs
 *   comparable time (see `verifyPassword`'s dummy-hash path), so an attacker
 *   cannot tell a wrong password from an unknown address.
 */

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import { needsRehash, hashPassword, verifyPassword } from '../../lib/auth/password';
import { type RoleName, requiresMfa } from '../../lib/authz/roles';
import { type Db, prisma } from '../../lib/db/client';
import { type CreatedSession, createSession, revokeSession } from './session-service';

/** Failed attempts before the account is temporarily locked. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
/** How long the account stays locked once the threshold is reached. */
export const LOCKOUT_DURATION_MS = 1000 * 60 * 15;

export type LoginOutcome =
  | { readonly result: 'SUCCESS'; readonly session: CreatedSession; readonly userId: string }
  | {
      readonly result: 'MFA_REQUIRED';
      /** Session exists but is not MFA-cleared; complete the challenge to use it. */
      readonly session: CreatedSession;
      readonly userId: string;
    }
  | {
      /**
       * The account holds an MFA-required role and has no second factor at all.
       * Signing in succeeded; nothing privileged is permitted until one is
       * enrolled, so the caller has to be sent to enrollment rather than to a
       * challenge there is no way to answer.
       */
      readonly result: 'MFA_ENROLLMENT_REQUIRED';
      readonly session: CreatedSession;
      readonly userId: string;
    }
  | { readonly result: 'INVALID_CREDENTIALS' }
  | { readonly result: 'ACCOUNT_LOCKED'; readonly lockedUntil: Date };

export async function login(
  params: { email: string; password: string; context?: RequestContext },
  db: Db = prisma,
): Promise<LoginOutcome> {
  const email = params.email.trim().toLowerCase();
  const now = new Date();

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      passwordHash: true,
      status: true,
      deletedAt: true,
      mfaEnabled: true,
      failedLoginCount: true,
      lockedUntil: true,
      roles: {
        where: { revokedAt: null },
        select: { role: { select: { name: true } } },
      },
    },
  });

  // Deleted accounts are treated exactly like non-existent ones.
  const candidate = user && !user.deletedAt ? user : null;

  if (candidate?.lockedUntil && candidate.lockedUntil.getTime() > now.getTime()) {
    await writeAudit(db, {
      action: AUDIT_ACTIONS.USER_LOGIN_BLOCKED,
      entityType: 'User',
      entityId: candidate.id,
      actorType: 'SYSTEM',
      severity: 'WARNING',
      afterState: { reason: 'account_locked', lockedUntil: candidate.lockedUntil.toISOString() },
      ...params.context,
    });
    return { result: 'ACCOUNT_LOCKED', lockedUntil: candidate.lockedUntil };
  }

  // Runs against a dummy hash when there is no candidate, so timing does not
  // distinguish "no such user" from "wrong password".
  const passwordOk = await verifyPassword(candidate?.passwordHash ?? null, params.password);

  if (!candidate || !passwordOk) {
    if (candidate) {
      const failedCount = candidate.failedLoginCount + 1;
      const shouldLock = failedCount >= MAX_FAILED_LOGIN_ATTEMPTS;

      await db.user.update({
        where: { id: candidate.id },
        data: {
          failedLoginCount: failedCount,
          lockedUntil: shouldLock ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : null,
        },
      });

      await writeAudit(db, {
        action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
        entityType: 'User',
        entityId: candidate.id,
        actorType: 'SYSTEM',
        severity: shouldLock ? 'WARNING' : 'NOTICE',
        afterState: { failedLoginCount: failedCount, locked: shouldLock },
        ...params.context,
      });
    }
    return { result: 'INVALID_CREDENTIALS' };
  }

  // Success. Clear the failure counter and opportunistically upgrade the hash if
  // cost parameters have been raised since it was written.
  const updates: { failedLoginCount: number; lockedUntil: null; passwordHash?: string } = {
    failedLoginCount: 0,
    lockedUntil: null,
  };
  if (candidate.passwordHash && needsRehash(candidate.passwordHash)) {
    updates.passwordHash = await hashPassword(params.password);
  }

  await db.user.update({
    where: { id: candidate.id },
    data: { ...updates, lastLoginAt: now },
  });

  const roles = candidate.roles.map((link) => link.role.name as RoleName);
  const roleNeedsMfa = requiresMfa(roles);
  // Un-cleared when there is a challenge to pass, and also when a privileged
  // role has no factor enrolled to pass one with.
  const mfaOutstanding = candidate.mfaEnabled || roleNeedsMfa;

  const session = await createSession(db, {
    userId: candidate.id,
    mfaSatisfied: !mfaOutstanding,
    ...(params.context ? { context: params.context } : {}),
  });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.USER_LOGIN_SUCCEEDED,
    entityType: 'User',
    entityId: candidate.id,
    actorUserId: candidate.id,
    afterState: {
      mfaRequired: mfaOutstanding,
      mfaEnrolled: candidate.mfaEnabled,
      roleRequiresMfa: roleNeedsMfa,
      status: candidate.status,
    },
    ...params.context,
  });

  if (candidate.mfaEnabled) return { result: 'MFA_REQUIRED', session, userId: candidate.id };
  if (roleNeedsMfa) return { result: 'MFA_ENROLLMENT_REQUIRED', session, userId: candidate.id };
  return { result: 'SUCCESS', session, userId: candidate.id };
}

/** Log out by revoking the current session. */
export async function logout(
  params: { sessionId: string; userId: string; context?: RequestContext },
  db: Db = prisma,
): Promise<void> {
  await revokeSession(db, {
    sessionId: params.sessionId,
    actorUserId: params.userId,
    ...(params.context ? { context: params.context } : {}),
  });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.USER_LOGGED_OUT,
    entityType: 'User',
    entityId: params.userId,
    actorUserId: params.userId,
    ...params.context,
  });
}

/** Clear a lockout early. Admin remediation path; the caller must authorize it. */
export async function clearLockout(
  params: { userId: string; actorUserId: string; context?: RequestContext },
  db: Db = prisma,
): Promise<void> {
  await db.user.update({
    where: { id: params.userId },
    data: { failedLoginCount: 0, lockedUntil: null },
  });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.USER_LOGIN_BLOCKED,
    entityType: 'User',
    entityId: params.userId,
    actorUserId: params.actorUserId,
    severity: 'NOTICE',
    afterState: { outcome: 'lockout_cleared' },
    ...params.context,
  });
}

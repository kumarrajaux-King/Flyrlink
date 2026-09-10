/**
 * Role assignment and revocation.
 *
 * This is the privilege-escalation boundary. Every entry point calls
 * `assertAuthorized(..., 'user:role:assign:any')`, which is SUPER_ADMIN-gated
 * *and* MFA-gated. The check lives inside the service rather than only in a
 * route handler, so no future caller can reach it unchecked.
 *
 * Granting or revoking a role changes what existing sessions may do, so all of
 * the target user's sessions are revoked. Otherwise a revoked admin would keep
 * their privileges until their session happened to expire.
 */

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit.js';
import { type Actor, assertAuthorized } from '../../lib/authz/authorize.js';
import { type RoleName } from '../../lib/authz/roles.js';
import { type Db, prisma } from '../../lib/db/client.js';
import { revokeAllSessions } from './session-service.js';

export type AssignRoleOutcome = 'ASSIGNED' | 'ALREADY_ASSIGNED' | 'USER_NOT_FOUND';

export async function assignRole(
  params: { actor: Actor; userId: string; role: RoleName; context?: RequestContext },
  db: Db = prisma,
): Promise<AssignRoleOutcome> {
  assertAuthorized(params.actor, 'user:role:assign:any');

  const [user, role] = await Promise.all([
    db.user.findUnique({ where: { id: params.userId }, select: { id: true, deletedAt: true } }),
    db.role.findUnique({ where: { name: params.role }, select: { id: true } }),
  ]);

  if (!user || user.deletedAt || !role) return 'USER_NOT_FOUND';

  const existing = await db.userRole.findUnique({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    select: { id: true, revokedAt: true },
  });

  if (existing && !existing.revokedAt) return 'ALREADY_ASSIGNED';

  await db.$transaction(async (tx) => {
    if (existing) {
      // Re-grant a previously revoked role rather than creating a duplicate,
      // which the (userId, roleId) unique constraint would reject anyway.
      await tx.userRole.update({
        where: { id: existing.id },
        data: { revokedAt: null, assignedById: params.actor.userId, assignedAt: new Date() },
      });
    } else {
      await tx.userRole.create({
        data: { userId: user.id, roleId: role.id, assignedById: params.actor.userId },
      });
    }

    await revokeAllSessions(tx, {
      userId: user.id,
      reason: `role_assigned:${params.role}`,
      actorUserId: params.actor.userId,
      ...(params.context ? { context: params.context } : {}),
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.ROLE_ASSIGNED,
      entityType: 'User',
      entityId: user.id,
      actorUserId: params.actor.userId,
      severity: 'CRITICAL',
      afterState: { role: params.role },
      ...params.context,
    });
  });

  return 'ASSIGNED';
}

export type RevokeRoleOutcome = 'REVOKED' | 'NOT_ASSIGNED' | 'USER_NOT_FOUND' | 'LAST_SUPER_ADMIN';

export async function revokeRole(
  params: { actor: Actor; userId: string; role: RoleName; context?: RequestContext },
  db: Db = prisma,
): Promise<RevokeRoleOutcome> {
  assertAuthorized(params.actor, 'user:role:assign:any');

  const role = await db.role.findUnique({ where: { name: params.role }, select: { id: true } });
  if (!role) return 'USER_NOT_FOUND';

  const link = await db.userRole.findUnique({
    where: { userId_roleId: { userId: params.userId, roleId: role.id } },
    select: { id: true, revokedAt: true },
  });
  if (!link || link.revokedAt) return 'NOT_ASSIGNED';

  // Refuse to remove the final SUPER_ADMIN — that would leave the platform with
  // nobody able to assign roles or change financial configuration, and no
  // in-product way to recover.
  if (params.role === 'SUPER_ADMIN') {
    const remaining = await db.userRole.count({
      where: { roleId: role.id, revokedAt: null, user: { deletedAt: null } },
    });
    if (remaining <= 1) return 'LAST_SUPER_ADMIN';
  }

  await db.$transaction(async (tx) => {
    await tx.userRole.update({ where: { id: link.id }, data: { revokedAt: new Date() } });

    await revokeAllSessions(tx, {
      userId: params.userId,
      reason: `role_revoked:${params.role}`,
      actorUserId: params.actor.userId,
      ...(params.context ? { context: params.context } : {}),
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.ROLE_REVOKED,
      entityType: 'User',
      entityId: params.userId,
      actorUserId: params.actor.userId,
      severity: 'CRITICAL',
      afterState: { role: params.role },
      ...params.context,
    });
  });

  return 'REVOKED';
}

/** Active roles for a user. */
export async function rolesForUser(userId: string, db: Db = prisma): Promise<RoleName[]> {
  const links = await db.userRole.findMany({
    where: { userId, revokedAt: null },
    select: { role: { select: { name: true } } },
  });
  return links.map((link) => link.role.name as RoleName);
}

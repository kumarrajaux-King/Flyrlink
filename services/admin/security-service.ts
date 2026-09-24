/**
 * Security and admin settings overview (Phase 8).
 *
 * A read-only view of the controls that protect the control plane itself: the
 * role → permission matrix, the MFA policy, the super-admin-only permissions,
 * every privileged account with its MFA and lockout state, and the last day's
 * security events.
 *
 * Nothing is configurable here. The RBAC matrix is code (`lib/authz/roles.ts`),
 * changed only by an approved release; role assignment remains the existing
 * SUPER_ADMIN + MFA endpoint; and the approved schema has no platform-settings
 * model to edit.
 */

import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import { assertCapability } from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import {
  MFA_REQUIRED_ROLES,
  PERMISSIONS,
  PRIVILEGED_ROLES,
  type Permission,
  ROLE_NAMES,
  ROLE_PERMISSIONS,
  type RoleName,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  requiresMfa,
} from '../../lib/authz/roles';
import { type Db, prisma } from '../../lib/db/client';
import { iso } from './pagination';

const EVENT_WINDOW_HOURS = 24;
const PRIVILEGED_ACCOUNT_LIMIT = 500;

export interface SecurityOverview {
  readonly permissionCount: number;
  readonly roles: readonly {
    readonly role: RoleName;
    readonly privileged: boolean;
    readonly mfaRequired: boolean;
    readonly permissions: readonly Permission[];
  }[];
  readonly superAdminOnlyPermissions: readonly Permission[];
  readonly privilegedAccounts: readonly {
    readonly userId: string;
    readonly email: string;
    readonly fullName: string;
    readonly status: string;
    readonly roles: readonly RoleName[];
    readonly mfaEnabled: boolean;
    readonly mfaRequired: boolean;
    readonly lastLoginAt: string | null;
    readonly locked: boolean;
    readonly activeSessions: number;
  }[];
  readonly alerts: {
    /** Accounts in an MFA-required role that have not enrolled — they cannot act until they do. */
    readonly privilegedWithoutMfa: number;
    readonly lockedPrivilegedAccounts: number;
    readonly activeSuperAdmins: number;
  };
  readonly recentEvents: {
    readonly windowHours: number;
    readonly loginFailures: number;
    readonly loginsBlocked: number;
    readonly authorizationDenials: number;
    readonly roleChanges: number;
    readonly accountSuspensionsAndReinstatements: number;
    readonly forcedSignOuts: number;
  };
}

export async function getSecurityOverview(
  params: { readonly actor: Actor },
  db: Db = prisma,
): Promise<SecurityOverview> {
  assertCapability(params.actor, 'SECURITY_READ');

  const now = new Date();
  const since = new Date(now.getTime() - EVENT_WINDOW_HOURS * 60 * 60 * 1000);
  const inWindow = (actions: readonly string[]) => ({ action: { in: [...actions] }, createdAt: { gte: since } });

  const [accounts, loginFailures, loginsBlocked, denials, roleChanges, suspensions, signOuts] = await Promise.all([
    db.user.findMany({
      where: { deletedAt: null, roles: { some: { revokedAt: null, role: { name: { in: [...PRIVILEGED_ROLES] } } } } },
      orderBy: { id: 'asc' },
      take: PRIVILEGED_ACCOUNT_LIMIT,
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        mfaEnabled: true,
        lastLoginAt: true,
        lockedUntil: true,
        roles: { where: { revokedAt: null }, select: { role: { select: { name: true } } } },
        _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: now } } } } },
      },
    }),
    db.auditLog.count({ where: inWindow([AUDIT_ACTIONS.USER_LOGIN_FAILED]) }),
    db.auditLog.count({ where: inWindow([AUDIT_ACTIONS.USER_LOGIN_BLOCKED]) }),
    db.auditLog.count({
      where: inWindow([
        AUDIT_ACTIONS.AUTHORIZATION_DENIED,
        AUDIT_ACTIONS.LIFECYCLE_TRANSITION_DENIED,
        AUDIT_ACTIONS.ADMIN_ACTION_DENIED,
      ]),
    }),
    db.auditLog.count({ where: inWindow([AUDIT_ACTIONS.ROLE_ASSIGNED, AUDIT_ACTIONS.ROLE_REVOKED]) }),
    db.auditLog.count({ where: inWindow([AUDIT_ACTIONS.ADMIN_ACCOUNT_TRANSITIONED]) }),
    db.auditLog.count({ where: inWindow([AUDIT_ACTIONS.ADMIN_SESSIONS_REVOKED]) }),
  ]);

  const privilegedAccounts = accounts.map((account) => {
    const roles = account.roles.map((link) => link.role.name as RoleName);
    return {
      userId: account.id,
      email: account.email,
      fullName: account.fullName,
      status: account.status,
      roles,
      mfaEnabled: account.mfaEnabled,
      mfaRequired: requiresMfa(roles),
      lastLoginAt: iso(account.lastLoginAt),
      locked: account.lockedUntil !== null && account.lockedUntil.getTime() > now.getTime(),
      activeSessions: account._count.sessions,
    };
  });

  return {
    permissionCount: PERMISSIONS.length,
    roles: ROLE_NAMES.map((role) => ({
      role,
      privileged: PRIVILEGED_ROLES.includes(role),
      mfaRequired: MFA_REQUIRED_ROLES.includes(role),
      permissions: ROLE_PERMISSIONS[role],
    })),
    superAdminOnlyPermissions: SUPER_ADMIN_ONLY_PERMISSIONS,
    privilegedAccounts,
    alerts: {
      privilegedWithoutMfa: privilegedAccounts.filter((account) => account.mfaRequired && !account.mfaEnabled).length,
      lockedPrivilegedAccounts: privilegedAccounts.filter((account) => account.locked).length,
      activeSuperAdmins: privilegedAccounts.filter(
        (account) => account.status === 'ACTIVE' && account.roles.includes('SUPER_ADMIN'),
      ).length,
    },
    recentEvents: {
      windowHours: EVENT_WINDOW_HOURS,
      loginFailures,
      loginsBlocked,
      authorizationDenials: denials,
      roleChanges,
      accountSuspensionsAndReinstatements: suspensions,
      forcedSignOuts: signOuts,
    },
  };
}

/**
 * People administration (Phase 8): users, customers and experts, and the account
 * controls — suspension and reinstatement, forced sign-out, lockout remediation.
 *
 * Reads never select credentials. `passwordHash`, `mfaSecret`, TOTP replay
 * state, session tokens and backup codes appear in no query in this file, so no
 * serialisation slip can leak them.
 *
 * Account controls follow three resource rules on top of RBAC (see
 * `lib/authz/admin-policy.ts`): no acting on your own account; only a super
 * administrator may act on a privileged account; and suspending a customer or an
 * expert also needs that population's own suspension grant.
 */

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import {
  adminDenialMessage,
  assertCapability,
  checkAccountTarget,
  hasCapability,
  normalizeReason,
  suspensionPermissionsFor,
} from '../../lib/authz/admin-policy';
import { type Actor, authorize } from '../../lib/authz/authorize';
import type { RoleName } from '../../lib/authz/roles';
import { type Db, type PrismaTransaction, prisma } from '../../lib/db/client';
import type { Prisma } from '../../src/generated/prisma/client';
import {
  ACCOUNT_MACHINE,
  type AccountContext,
  type AccountEvent,
  type AccountState,
} from '../../domain/account/state-machine';
import {
  type VerificationStage,
  type VerificationState,
  verificationStage,
} from '../../domain/verification/state-machine';
import { clearLockout } from '../auth/login-service';
import { revokeAllSessions } from '../auth/session-service';
import { executeAdminMutation } from './admin-mutation';
import { type GovernedRequest, type GovernedSpec, executeGovernedChange } from './governed-change';
import { type AdminOutcome, AdminRejection, isUuid, lockRow, precondition } from './outcome';
import { type Page, type PageRequest, iso, minor, newestFirst, pageSize, toPage } from './pagination';

const INSENSITIVE = 'insensitive' as const;

const ACTIVE_ROLE_LINKS = {
  where: { revokedAt: null },
  select: { role: { select: { name: true } } },
} as const;

function roleNames(links: readonly { readonly role: { readonly name: string } }[]): RoleName[] {
  return links.map((link) => link.role.name as RoleName);
}

function contextSpread(context: RequestContext | undefined): { context?: RequestContext } {
  return context ? { context } : {};
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface AdminUserSummary {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: string;
  readonly roles: readonly RoleName[];
  readonly emailVerified: boolean;
  readonly mfaEnabled: boolean;
  readonly locked: boolean;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

const USER_SUMMARY_SELECT = {
  id: true,
  email: true,
  fullName: true,
  status: true,
  emailVerified: true,
  mfaEnabled: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  roles: ACTIVE_ROLE_LINKS,
} satisfies Prisma.UserSelect;

interface UserSummaryRow {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: string;
  readonly emailVerified: Date | null;
  readonly mfaEnabled: boolean;
  readonly lockedUntil: Date | null;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly roles: readonly { readonly role: { readonly name: string } }[];
}

function toUserSummary(row: UserSummaryRow, now: Date): AdminUserSummary {
  return {
    userId: row.id,
    email: row.email,
    fullName: row.fullName,
    status: row.status,
    roles: roleNames(row.roles),
    emailVerified: row.emailVerified !== null,
    mfaEnabled: row.mfaEnabled,
    locked: row.lockedUntil !== null && row.lockedUntil.getTime() > now.getTime(),
    lastLoginAt: iso(row.lastLoginAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listUsers(
  params: PageRequest & {
    readonly actor: Actor;
    readonly q?: string | undefined;
    readonly status?: AccountState | undefined;
    readonly role?: RoleName | undefined;
  },
  db: Db = prisma,
): Promise<Page<AdminUserSummary>> {
  assertCapability(params.actor, 'USERS_READ');
  const size = pageSize(params.limit);

  const rows = await db.user.findMany({
    where: {
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
      ...(params.role ? { roles: { some: { revokedAt: null, role: { name: params.role } } } } : {}),
      ...(params.q
        ? {
            OR: [
              { email: { contains: params.q, mode: INSENSITIVE } },
              { fullName: { contains: params.q, mode: INSENSITIVE } },
            ],
          }
        : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: USER_SUMMARY_SELECT,
  });

  const now = new Date();
  return toPage(rows, size, (row) => toUserSummary(row, now));
}

export interface AdminUserDetail extends AdminUserSummary {
  readonly failedLoginCount: number;
  readonly lockedUntil: string | null;
  readonly mfaEnrolledAt: string | null;
  readonly activeSessions: number;
  readonly roleAssignments: readonly {
    readonly role: RoleName;
    readonly assignedAt: string;
    readonly assignedById: string | null;
  }[];
  readonly customerProfileId: string | null;
  readonly expertProfileId: string | null;
  readonly updatedAt: string;
}

export async function getUser(
  params: { readonly actor: Actor; readonly userId: string },
  db: Db = prisma,
): Promise<AdminUserDetail | null> {
  assertCapability(params.actor, 'USERS_READ');
  if (!isUuid(params.userId)) return null;

  const now = new Date();
  const user = await db.user.findFirst({
    where: { id: params.userId, deletedAt: null },
    select: {
      ...USER_SUMMARY_SELECT,
      failedLoginCount: true,
      mfaEnrolledAt: true,
      updatedAt: true,
      roles: {
        where: { revokedAt: null },
        select: { assignedAt: true, assignedById: true, role: { select: { name: true } } },
      },
      customerProfile: { select: { id: true } },
      expertProfile: { select: { id: true } },
      _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: now } } } } },
    },
  });
  if (!user) return null;

  return {
    ...toUserSummary(user, now),
    failedLoginCount: user.failedLoginCount,
    lockedUntil: iso(user.lockedUntil),
    mfaEnrolledAt: iso(user.mfaEnrolledAt),
    activeSessions: user._count.sessions,
    roleAssignments: user.roles.map((link) => ({
      role: link.role.name as RoleName,
      assignedAt: link.assignedAt.toISOString(),
      assignedById: link.assignedById,
    })),
    customerProfileId: user.customerProfile?.id ?? null,
    expertProfileId: user.expertProfile?.id ?? null,
    updatedAt: user.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface AdminCustomerSummary {
  readonly customerId: string;
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly accountStatus: string;
  readonly companyName: string | null;
  readonly industry: string | null;
  readonly billingCountry: string | null;
  readonly defaultCurrency: string;
  readonly projectCount: number;
  readonly contractCount: number;
  readonly createdAt: string;
}

const CUSTOMER_SUMMARY_SELECT = {
  id: true,
  companyName: true,
  industry: true,
  billingCountry: true,
  defaultCurrency: true,
  createdAt: true,
  user: { select: { id: true, email: true, fullName: true, status: true } },
  _count: { select: { projects: true, contracts: true } },
} satisfies Prisma.CustomerProfileSelect;

interface CustomerSummaryRow {
  readonly id: string;
  readonly companyName: string | null;
  readonly industry: string | null;
  readonly billingCountry: string | null;
  readonly defaultCurrency: string;
  readonly createdAt: Date;
  readonly user: { readonly id: string; readonly email: string; readonly fullName: string; readonly status: string };
  readonly _count: { readonly projects: number; readonly contracts: number };
}

function toCustomerSummary(row: CustomerSummaryRow): AdminCustomerSummary {
  return {
    customerId: row.id,
    userId: row.user.id,
    fullName: row.user.fullName,
    email: row.user.email,
    accountStatus: row.user.status,
    companyName: row.companyName,
    industry: row.industry,
    billingCountry: row.billingCountry,
    defaultCurrency: row.defaultCurrency,
    projectCount: row._count.projects,
    contractCount: row._count.contracts,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listCustomers(
  params: PageRequest & {
    readonly actor: Actor;
    readonly q?: string | undefined;
    readonly status?: AccountState | undefined;
  },
  db: Db = prisma,
): Promise<Page<AdminCustomerSummary>> {
  assertCapability(params.actor, 'CUSTOMERS_READ');
  const size = pageSize(params.limit);

  const rows = await db.customerProfile.findMany({
    where: {
      user: { deletedAt: null, ...(params.status ? { status: params.status } : {}) },
      ...(params.q
        ? {
            OR: [
              { companyName: { contains: params.q, mode: INSENSITIVE } },
              { user: { email: { contains: params.q, mode: INSENSITIVE } } },
              { user: { fullName: { contains: params.q, mode: INSENSITIVE } } },
            ],
          }
        : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: CUSTOMER_SUMMARY_SELECT,
  });

  return toPage(rows, size, toCustomerSummary);
}

export interface AdminCustomerDetail extends AdminCustomerSummary {
  readonly website: string | null;
  readonly companySize: string | null;
  readonly projectsByStatus: readonly { readonly status: string; readonly count: number }[];
  readonly contractsByStatus: readonly { readonly status: string; readonly count: number }[];
  readonly openDisputes: number;
}

export async function getCustomer(
  params: { readonly actor: Actor; readonly customerId: string },
  db: Db = prisma,
): Promise<AdminCustomerDetail | null> {
  assertCapability(params.actor, 'CUSTOMERS_READ');
  if (!isUuid(params.customerId)) return null;

  const customer = await db.customerProfile.findFirst({
    where: { id: params.customerId, user: { deletedAt: null } },
    select: { ...CUSTOMER_SUMMARY_SELECT, website: true, companySize: true },
  });
  if (!customer) return null;

  const [projects, contracts, openDisputes] = await Promise.all([
    db.project.groupBy({
      by: ['status'],
      where: { customerId: customer.id, deletedAt: null },
      _count: { _all: true },
    }),
    db.contract.groupBy({ by: ['status'], where: { customerId: customer.id }, _count: { _all: true } }),
    db.dispute.count({
      where: {
        project: { customerId: customer.id },
        status: { in: ['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE', 'ESCALATED'] },
      },
    }),
  ]);

  return {
    ...toCustomerSummary(customer),
    website: customer.website,
    companySize: customer.companySize,
    projectsByStatus: projects.map((group) => ({ status: group.status, count: group._count._all })),
    contractsByStatus: contracts.map((group) => ({ status: group.status, count: group._count._all })),
    openDisputes,
  };
}

// ---------------------------------------------------------------------------
// Experts
// ---------------------------------------------------------------------------

export interface AdminExpertSummary {
  readonly expertId: string;
  readonly userId: string;
  readonly slug: string;
  readonly fullName: string;
  readonly email: string;
  readonly accountStatus: string;
  readonly headline: string | null;
  readonly yearsOfExperience: number;
  readonly verificationStatus: string;
  readonly verifiedAt: string | null;
  readonly availabilityStatus: string;
  readonly isAcceptingWork: boolean;
  readonly hourlyRateMinor: string | null;
  readonly currency: string;
  /** As stored on `ExpertPerformance` (integer scale); null when never computed. */
  readonly avgRating: number | null;
  readonly reviewCount: number;
  readonly completedProjects: number;
  readonly serviceCount: number;
  readonly contractCount: number;
  readonly createdAt: string;
}

const EXPERT_SUMMARY_SELECT = {
  id: true,
  slug: true,
  headline: true,
  yearsOfExperience: true,
  verificationStatus: true,
  verifiedAt: true,
  availabilityStatus: true,
  isAcceptingWork: true,
  hourlyRateMinor: true,
  currency: true,
  createdAt: true,
  user: { select: { id: true, email: true, fullName: true, status: true } },
  performance: { select: { avgRating: true, reviewCount: true, completedProjects: true } },
  _count: { select: { services: true, contracts: true } },
} satisfies Prisma.ExpertProfileSelect;

interface ExpertSummaryRow {
  readonly id: string;
  readonly slug: string;
  readonly headline: string | null;
  readonly yearsOfExperience: number;
  readonly verificationStatus: string;
  readonly verifiedAt: Date | null;
  readonly availabilityStatus: string;
  readonly isAcceptingWork: boolean;
  readonly hourlyRateMinor: bigint | null;
  readonly currency: string;
  readonly createdAt: Date;
  readonly user: { readonly id: string; readonly email: string; readonly fullName: string; readonly status: string };
  readonly performance: {
    readonly avgRating: number;
    readonly reviewCount: number;
    readonly completedProjects: number;
  } | null;
  readonly _count: { readonly services: number; readonly contracts: number };
}

function toExpertSummary(row: ExpertSummaryRow): AdminExpertSummary {
  return {
    expertId: row.id,
    userId: row.user.id,
    slug: row.slug,
    fullName: row.user.fullName,
    email: row.user.email,
    accountStatus: row.user.status,
    headline: row.headline,
    yearsOfExperience: row.yearsOfExperience,
    verificationStatus: row.verificationStatus,
    verifiedAt: iso(row.verifiedAt),
    availabilityStatus: row.availabilityStatus,
    isAcceptingWork: row.isAcceptingWork,
    hourlyRateMinor: minor(row.hourlyRateMinor),
    currency: row.currency,
    avgRating: row.performance?.avgRating ?? null,
    reviewCount: row.performance?.reviewCount ?? 0,
    completedProjects: row.performance?.completedProjects ?? 0,
    serviceCount: row._count.services,
    contractCount: row._count.contracts,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listExperts(
  params: PageRequest & {
    readonly actor: Actor;
    readonly q?: string | undefined;
    readonly verificationStatus?: VerificationState | undefined;
  },
  db: Db = prisma,
): Promise<Page<AdminExpertSummary>> {
  assertCapability(params.actor, 'EXPERTS_READ');
  const size = pageSize(params.limit);

  const rows = await db.expertProfile.findMany({
    where: {
      deletedAt: null,
      user: { deletedAt: null },
      ...(params.verificationStatus ? { verificationStatus: params.verificationStatus } : {}),
      ...(params.q
        ? {
            OR: [
              { slug: { contains: params.q, mode: INSENSITIVE } },
              { headline: { contains: params.q, mode: INSENSITIVE } },
              { user: { email: { contains: params.q, mode: INSENSITIVE } } },
              { user: { fullName: { contains: params.q, mode: INSENSITIVE } } },
            ],
          }
        : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: EXPERT_SUMMARY_SELECT,
  });

  return toPage(rows, size, toExpertSummary);
}

export interface AdminExpertDetail extends AdminExpertSummary {
  readonly bio: string | null;
  readonly timezone: string;
  readonly weeklyCapacityHours: number | null;
  readonly profileCompleteness: number;
  readonly skills: readonly {
    readonly name: string;
    readonly proficiency: string;
    readonly yearsOfExperience: number;
    readonly isPrimary: boolean;
  }[];
  readonly certifications: readonly {
    readonly name: string;
    readonly issuingOrganization: string;
    readonly verificationStatus: string;
    readonly expiryDate: string | null;
  }[];
  /** Present only for callers who may read verification cases. */
  readonly verifications:
    | readonly {
        readonly verificationId: string;
        readonly status: string;
        readonly stage: VerificationStage;
        readonly submittedAt: string;
        readonly reviewedAt: string | null;
        readonly aiFlagCount: number;
      }[]
    | null;
}

export async function getExpert(
  params: { readonly actor: Actor; readonly expertId: string },
  db: Db = prisma,
): Promise<AdminExpertDetail | null> {
  assertCapability(params.actor, 'EXPERTS_READ');
  if (!isUuid(params.expertId)) return null;

  const canReadVerifications = hasCapability(params.actor, 'VERIFICATIONS_READ');
  const expert = await db.expertProfile.findFirst({
    where: { id: params.expertId, deletedAt: null, user: { deletedAt: null } },
    select: {
      ...EXPERT_SUMMARY_SELECT,
      bio: true,
      timezone: true,
      weeklyCapacityHours: true,
      profileCompleteness: true,
      skills: {
        orderBy: { isPrimary: 'desc' },
        select: { proficiency: true, yearsOfExperience: true, isPrimary: true, skill: { select: { name: true } } },
      },
      certifications: {
        select: { name: true, issuingOrganization: true, verificationStatus: true, expiryDate: true },
      },
      verifications: {
        orderBy: { id: 'desc' },
        take: 20,
        select: { id: true, status: true, submittedAt: true, reviewedAt: true, aiFlagCount: true },
      },
    },
  });
  if (!expert) return null;

  return {
    ...toExpertSummary(expert),
    bio: expert.bio,
    timezone: expert.timezone,
    weeklyCapacityHours: expert.weeklyCapacityHours,
    profileCompleteness: expert.profileCompleteness,
    skills: expert.skills.map((entry) => ({
      name: entry.skill.name,
      proficiency: entry.proficiency,
      yearsOfExperience: entry.yearsOfExperience,
      isPrimary: entry.isPrimary,
    })),
    certifications: expert.certifications.map((certification) => ({
      name: certification.name,
      issuingOrganization: certification.issuingOrganization,
      verificationStatus: certification.verificationStatus,
      expiryDate: iso(certification.expiryDate),
    })),
    verifications: canReadVerifications
      ? expert.verifications.map((verification) => ({
          verificationId: verification.id,
          status: verification.status,
          stage: verificationStage(verification),
          submittedAt: verification.submittedAt.toISOString(),
          reviewedAt: iso(verification.reviewedAt),
          aiFlagCount: verification.aiFlagCount,
        }))
      : null,
  };
}

// ---------------------------------------------------------------------------
// Account standing — suspension and reinstatement
// ---------------------------------------------------------------------------

interface AccountRow {
  readonly id: string;
  readonly status: AccountState;
  readonly emailVerified: Date | null;
  readonly roles: readonly { readonly role: { readonly name: string } }[];
}

const ACCOUNT_SPEC: GovernedSpec<AccountState, AccountEvent, AccountContext, AccountRow, null> = {
  entityType: 'User',
  table: 'users',
  machine: ACCOUNT_MACHINE,
  auditAction: AUDIT_ACTIONS.ADMIN_ACCOUNT_TRANSITIONED,

  load: (tx, id) =>
    tx.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, emailVerified: true, roles: ACTIVE_ROLE_LINKS },
    }),

  status: (row) => row.status,

  context: (row) => ({ emailVerified: row.emailVerified !== null }),

  async guard(_tx, row, _event, actor) {
    const roles = roleNames(row.roles);
    const targetDenial = checkAccountTarget(actor, { userId: row.id, roles });
    if (targetDenial) return targetDenial;

    for (const permission of suspensionPermissionsFor(roles)) {
      const decision = authorize(actor, permission);
      if (!decision.allowed) return decision.reason;
    }
    return null;
  },

  async prepare({ tx, entity, event }) {
    if (event === 'SUSPEND' && roleNames(entity.roles).includes('SUPER_ADMIN')) {
      const otherActiveSuperAdmins = await tx.userRole.count({
        where: {
          revokedAt: null,
          role: { name: 'SUPER_ADMIN' },
          user: { id: { not: entity.id }, deletedAt: null, status: 'ACTIVE' },
        },
      });
      // Suspending the last one would leave nobody able to reinstate anyone.
      if (otherActiveSuperAdmins === 0) {
        throw precondition('The last active super administrator cannot be suspended.');
      }
    }
    return null;
  },

  async write({ tx, entity, from, to }) {
    const result = await tx.user.updateMany({ where: { id: entity.id, status: from }, data: { status: to } });
    return result.count;
  },

  async effects({ tx, entity, event, request }) {
    if (event !== 'SUSPEND') return {};
    // A suspended account must lose access now, not when its sessions expire.
    const sessionsRevoked = await revokeAllSessions(tx, {
      userId: entity.id,
      reason: 'account_suspended',
      actorUserId: request.actor.userId,
      ...contextSpread(request.context),
    });
    return { sessionsRevoked };
  },
};

/** Suspend or reinstate an account. */
export function transitionAccount(request: GovernedRequest, db: Db = prisma): Promise<AdminOutcome> {
  return executeGovernedChange(ACCOUNT_SPEC, request, db);
}

// ---------------------------------------------------------------------------
// Forced sign-out and lockout remediation
// ---------------------------------------------------------------------------

async function lockAccountTarget(tx: PrismaTransaction, userId: string) {
  if (!(await lockRow(tx, 'users', userId))) return null;
  return tx.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, failedLoginCount: true, lockedUntil: true, roles: ACTIVE_ROLE_LINKS },
  });
}

function assertAccountTarget(actor: Actor, target: { id: string; roles: readonly { role: { name: string } }[] }): void {
  const denial = checkAccountTarget(actor, { userId: target.id, roles: roleNames(target.roles) });
  if (denial) throw new AdminRejection('FORBIDDEN', adminDenialMessage(denial), { denyReason: denial });
}

/** Sign an account out everywhere. */
export async function revokeUserSessions(
  params: {
    readonly actor: Actor;
    readonly userId: string;
    readonly reason?: string | undefined;
    readonly context?: RequestContext | undefined;
  },
  db: Db = prisma,
): Promise<AdminOutcome> {
  return executeAdminMutation(
    {
      entityType: 'User',
      entityId: params.userId,
      event: 'REVOKE_SESSIONS',
      actor: params.actor,
      capability: 'USERS_REVOKE_SESSIONS',
      risk: 'MEDIUM',
      justification: { reason: params.reason },
      context: params.context,
      async run(tx, base) {
        const target = await lockAccountTarget(tx, params.userId);
        if (!target) throw new AdminRejection('NOT_FOUND', 'No account with that id.');
        assertAccountTarget(params.actor, target);

        const sessionsRevoked = await revokeAllSessions(tx, {
          userId: target.id,
          reason: 'admin_forced_sign_out',
          actorUserId: params.actor.userId,
          ...contextSpread(params.context),
        });

        await writeAudit(tx, {
          action: AUDIT_ACTIONS.ADMIN_SESSIONS_REVOKED,
          entityType: 'User',
          entityId: target.id,
          actorUserId: params.actor.userId,
          severity: 'WARNING',
          afterState: { reason: normalizeReason(params.reason), sessionsRevoked },
          ...params.context,
        });

        return { ...base, result: 'APPLIED', from: null, to: null, cascades: [], detail: { sessionsRevoked } };
      },
    },
    db,
  );
}

/** Clear a login lockout early — the STEP 4 admin remediation path, now authorized and justified. */
export async function clearUserLockout(
  params: {
    readonly actor: Actor;
    readonly userId: string;
    readonly reason?: string | undefined;
    readonly context?: RequestContext | undefined;
  },
  db: Db = prisma,
): Promise<AdminOutcome> {
  return executeAdminMutation(
    {
      entityType: 'User',
      entityId: params.userId,
      event: 'CLEAR_LOCKOUT',
      actor: params.actor,
      capability: 'USERS_CLEAR_LOCKOUT',
      risk: 'MEDIUM',
      justification: { reason: params.reason },
      context: params.context,
      async run(tx, base) {
        const target = await lockAccountTarget(tx, params.userId);
        if (!target) throw new AdminRejection('NOT_FOUND', 'No account with that id.');
        assertAccountTarget(params.actor, target);

        const locked = target.lockedUntil !== null && target.lockedUntil.getTime() > Date.now();
        if (!locked && target.failedLoginCount === 0) {
          return { ...base, result: 'NO_OP', status: null };
        }

        await clearLockout({ userId: target.id, actorUserId: params.actor.userId, ...contextSpread(params.context) }, tx);

        await writeAudit(tx, {
          action: AUDIT_ACTIONS.ADMIN_LOCKOUT_CLEARED,
          entityType: 'User',
          entityId: target.id,
          actorUserId: params.actor.userId,
          severity: 'NOTICE',
          beforeState: { failedLoginCount: target.failedLoginCount, lockedUntil: iso(target.lockedUntil) },
          afterState: { reason: normalizeReason(params.reason), failedLoginCount: 0, lockedUntil: null },
          ...params.context,
        });

        return { ...base, result: 'APPLIED', from: null, to: null, cascades: [] };
      },
    },
    db,
  );
}

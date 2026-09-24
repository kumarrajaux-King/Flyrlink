/**
 * The admin dashboard foundation (Phase 8) — STEP 01 §9.1's operational
 * intelligence, as counts.
 *
 * Every section is decided by its own capability, server-side. A support agent
 * gets operations and disputes but no finance; finance gets money but no
 * moderation queue. A section the caller may not read is absent from the
 * response — not zeroed — so a role cannot infer figures it was never granted.
 * A caller who may read no section at all is refused.
 *
 * Counts only: no names, no amounts per person, no payloads.
 */

import { type AdminCapability, authorizeCapability } from '../../lib/authz/admin-policy';
import { type Actor, AuthorizationError, type DenyReason } from '../../lib/authz/authorize';
import type { Permission } from '../../lib/authz/roles';
import { type Db, prisma } from '../../lib/db/client';
import { DISPUTE_OPEN_STATES } from '../../domain/dispute/triage-machine';
import { minor } from './pagination';

const SECTIONS = {
  operations: 'PROJECTS_READ',
  trust: 'USERS_READ',
  disputes: 'DISPUTES_READ',
  payments: 'PAYMENTS_READ',
  payouts: 'PAYOUTS_READ',
  moderation: 'REVIEWS_MODERATE',
  ai: 'AI_READ',
} as const satisfies Record<string, AdminCapability>;

export type DashboardSection = keyof typeof SECTIONS;

export const DASHBOARD_SECTIONS = Object.keys(SECTIONS) as DashboardSection[];

export interface AdminDashboard {
  readonly generatedAt: string;
  readonly sections: readonly DashboardSection[];
  readonly operations?: {
    readonly activeProjects: number;
    readonly atRiskProjects: number;
    readonly suspendedProjects: number;
    readonly disputedProjects: number;
    readonly pendingAssignments: number;
  };
  readonly trust?: {
    readonly suspendedAccounts: number;
    readonly lockedAccounts: number;
    readonly pendingVerifications: number;
  };
  readonly disputes?: {
    readonly open: number;
    readonly byStatus: readonly { readonly status: string; readonly count: number }[];
  };
  readonly payments?: {
    readonly failedLast30Days: number;
    readonly refundRequested: number;
    readonly releasePending: number;
  };
  readonly payouts?: {
    readonly pendingApproval: number;
    readonly onHold: number;
    readonly approvedAwaitingProcessing: number;
  };
  readonly moderation?: {
    readonly flagged: number;
    readonly underModeration: number;
  };
  readonly ai?: {
    readonly pendingApprovals: number;
    readonly failedRunsLast24Hours: number;
    readonly runsLast30Days: number;
    readonly costLast30Days: readonly { readonly currency: string | null; readonly costMinor: string }[];
  };
}

/** When no section is readable, report the most useful reason (e.g. MFA) rather than a bare "missing permission". */
function refusal(denials: readonly { reason: DenyReason; permission: Permission }[]): AuthorizationError {
  const specific = denials.find((denial) => denial.reason !== 'MISSING_PERMISSION') ?? denials[0];
  return new AuthorizationError(specific?.reason ?? 'MISSING_PERMISSION', specific?.permission ?? 'user:read:any');
}

export async function getDashboard(params: { readonly actor: Actor }, db: Db = prisma): Promise<AdminDashboard> {
  const allowed: DashboardSection[] = [];
  const denials: { reason: DenyReason; permission: Permission }[] = [];

  for (const section of DASHBOARD_SECTIONS) {
    const decision = authorizeCapability(params.actor, SECTIONS[section]);
    if (decision.allowed) allowed.push(section);
    else denials.push({ reason: decision.reason, permission: decision.permission });
  }
  if (allowed.length === 0) throw refusal(denials);

  const now = new Date();
  const days = (count: number) => new Date(now.getTime() - count * 24 * 60 * 60 * 1000);
  const has = (section: DashboardSection) => allowed.includes(section);

  const [operations, trust, disputes, payments, payouts, moderation, ai] = await Promise.all([
    has('operations')
      ? Promise.all([
          db.project.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
          db.project.count({ where: { deletedAt: null, status: 'AT_RISK' } }),
          db.project.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
          db.project.count({ where: { deletedAt: null, status: 'DISPUTED' } }),
          db.assignment.count({ where: { status: { in: ['PENDING_APPROVAL', 'INVITED'] } } }),
        ]).then(([activeProjects, atRiskProjects, suspendedProjects, disputedProjects, pendingAssignments]) => ({
          activeProjects,
          atRiskProjects,
          suspendedProjects,
          disputedProjects,
          pendingAssignments,
        }))
      : null,
    has('trust')
      ? Promise.all([
          db.user.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
          db.user.count({ where: { deletedAt: null, lockedUntil: { gt: now } } }),
          db.expertVerification.count({ where: { status: { in: ['PENDING', 'IN_REVIEW'] } } }),
        ]).then(([suspendedAccounts, lockedAccounts, pendingVerifications]) => ({
          suspendedAccounts,
          lockedAccounts,
          pendingVerifications,
        }))
      : null,
    has('disputes')
      ? db.dispute
          .groupBy({ by: ['status'], where: { status: { in: [...DISPUTE_OPEN_STATES] } }, _count: { _all: true } })
          .then((groups) => ({
            open: groups.reduce((sum, group) => sum + group._count._all, 0),
            byStatus: groups.map((group) => ({ status: group.status, count: group._count._all })),
          }))
      : null,
    has('payments')
      ? Promise.all([
          db.payment.count({ where: { status: 'FAILED', createdAt: { gte: days(30) } } }),
          db.payment.count({ where: { status: 'REFUND_REQUESTED' } }),
          db.payment.count({ where: { status: 'RELEASE_PENDING' } }),
        ]).then(([failedLast30Days, refundRequested, releasePending]) => ({
          failedLast30Days,
          refundRequested,
          releasePending,
        }))
      : null,
    has('payouts')
      ? Promise.all([
          db.payout.count({ where: { status: 'PENDING_APPROVAL' } }),
          db.payout.count({ where: { status: 'ON_HOLD' } }),
          db.payout.count({ where: { status: 'APPROVED' } }),
        ]).then(([pendingApproval, onHold, approvedAwaitingProcessing]) => ({
          pendingApproval,
          onHold,
          approvedAwaitingProcessing,
        }))
      : null,
    has('moderation')
      ? Promise.all([
          db.review.count({ where: { deletedAt: null, status: 'FLAGGED' } }),
          db.review.count({ where: { deletedAt: null, status: 'UNDER_MODERATION' } }),
        ]).then(([flagged, underModeration]) => ({ flagged, underModeration }))
      : null,
    has('ai')
      ? Promise.all([
          db.aiAction.count({ where: { status: 'PENDING_APPROVAL', requiresHumanApproval: true } }),
          db.aiRun.count({
            where: { status: { in: ['FAILED', 'TIMED_OUT', 'VALIDATION_FAILED'] }, createdAt: { gte: days(1) } },
          }),
          db.aiRun.count({ where: { createdAt: { gte: days(30) } } }),
          db.aiRun.groupBy({ by: ['currency'], where: { createdAt: { gte: days(30) } }, _sum: { costMinor: true } }),
        ]).then(([pendingApprovals, failedRunsLast24Hours, runsLast30Days, cost]) => ({
          pendingApprovals,
          failedRunsLast24Hours,
          runsLast30Days,
          costLast30Days: cost
            .filter((group) => group._sum.costMinor !== null)
            .map((group) => ({ currency: group.currency, costMinor: minor(group._sum.costMinor) ?? '0' })),
        }))
      : null,
  ]);

  return {
    generatedAt: now.toISOString(),
    sections: allowed,
    ...(operations ? { operations } : {}),
    ...(trust ? { trust } : {}),
    ...(disputes ? { disputes } : {}),
    ...(payments ? { payments } : {}),
    ...(payouts ? { payouts } : {}),
    ...(moderation ? { moderation } : {}),
    ...(ai ? { ai } : {}),
  };
}

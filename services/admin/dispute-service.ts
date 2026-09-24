/**
 * Dispute management (Phase 8): the queue, the case file, triage and
 * resolution.
 *
 * Triage organises the work — review, evidence requests, escalation — through
 * the dispute triage machine. Resolution is never a status write here: it is
 * the Phase 6 `RESOLVE_DISPUTE` event on the disputed milestone, contract or
 * project, taken as a governed intervention. Resolving a dispute therefore
 * restores or closes the record it froze and resolves the dispute in one
 * lifecycle transaction, with every lifecycle rule applied.
 *
 * A party to the dispute — whoever raised it, the customer, or an expert on the
 * engagement — can neither triage nor resolve it.
 *
 * Awards (`customerAwardMinor`, `expertAwardMinor`) are shown but never set:
 * an award moves money, and that waits for the Phase 10 ledger.
 */

import { AUDIT_ACTIONS, type RequestContext } from '../../lib/audit/audit';
import {
  assertCapability,
  authorizeCapability,
  checkJustification,
  checkNotParty,
} from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import {
  DISPUTE_OPEN_STATES,
  DISPUTE_TRIAGE_MACHINE,
  type DisputeState,
  type DisputeTriageContext,
  type DisputeTriageEvent,
} from '../../domain/dispute/triage-machine';
import { availableEvents } from '../../domain/lifecycle/machine';
import type { DisputeResolution, LifecycleEntityType } from '../lifecycle';
import { denialMessage } from '../lifecycle/authorization';
import { type GovernedRequest, type GovernedSpec, executeGovernedChange } from './governed-change';
import { type HistoryEntry, auditHistory } from './history';
import { EXPERT_SIDE, type ExpertSide, expertSideUserIds, interveneInLifecycle } from './intervention-service';
import { type AdminOutcome, AdminRejection, auditAdminDenial, isUuid, precondition, rejectedOutcome } from './outcome';
import { type Page, type PageRequest, iso, minor, newestFirst, pageSize, toPage } from './pagination';

export type DisputeLevel = 'PROJECT' | 'CONTRACT' | 'MILESTONE';

/** The narrowest record a dispute froze. A milestone dispute also names its contract. */
export function disputeLevel(dispute: { readonly contractId: string | null; readonly milestoneId: string | null }): DisputeLevel {
  if (dispute.milestoneId) return 'MILESTONE';
  if (dispute.contractId) return 'CONTRACT';
  return 'PROJECT';
}

// ---------------------------------------------------------------------------
// Queue and case file
// ---------------------------------------------------------------------------

export interface AdminDisputeSummary {
  readonly disputeId: string;
  readonly status: string;
  readonly level: DisputeLevel;
  readonly reason: string;
  readonly project: { readonly projectId: string; readonly projectNumber: string; readonly title: string };
  readonly contractId: string | null;
  readonly milestoneId: string | null;
  readonly disputedAmountMinor: string | null;
  readonly currency: string | null;
  readonly raisedBy: { readonly userId: string; readonly fullName: string };
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

const SUMMARY_SELECT = {
  id: true,
  status: true,
  reason: true,
  contractId: true,
  milestoneId: true,
  disputedAmountMinor: true,
  currency: true,
  createdAt: true,
  resolvedAt: true,
  project: { select: { id: true, projectNumber: true, title: true } },
  raisedBy: { select: { id: true, fullName: true } },
} as const;

interface SummaryRow {
  readonly id: string;
  readonly status: string;
  readonly reason: string;
  readonly contractId: string | null;
  readonly milestoneId: string | null;
  readonly disputedAmountMinor: bigint | null;
  readonly currency: string | null;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
  readonly project: { readonly id: string; readonly projectNumber: string; readonly title: string };
  readonly raisedBy: { readonly id: string; readonly fullName: string };
}

function toSummary(row: SummaryRow): AdminDisputeSummary {
  return {
    disputeId: row.id,
    status: row.status,
    level: disputeLevel(row),
    reason: row.reason,
    project: { projectId: row.project.id, projectNumber: row.project.projectNumber, title: row.project.title },
    contractId: row.contractId,
    milestoneId: row.milestoneId,
    disputedAmountMinor: minor(row.disputedAmountMinor),
    currency: row.currency,
    raisedBy: { userId: row.raisedBy.id, fullName: row.raisedBy.fullName },
    createdAt: row.createdAt.toISOString(),
    resolvedAt: iso(row.resolvedAt),
  };
}

export async function listDisputes(
  params: PageRequest & {
    readonly actor: Actor;
    readonly status?: DisputeState | undefined;
    readonly projectId?: string | undefined;
  },
  db: Db = prisma,
): Promise<Page<AdminDisputeSummary>> {
  assertCapability(params.actor, 'DISPUTES_READ');
  const size = pageSize(params.limit);

  const rows = await db.dispute.findMany({
    where: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: SUMMARY_SELECT,
  });

  return toPage(rows, size, toSummary);
}

export interface AdminDisputeDetail extends AdminDisputeSummary {
  readonly description: string;
  readonly resolutionNotes: string | null;
  readonly resolvedBy: { readonly userId: string; readonly fullName: string } | null;
  readonly customerAwardMinor: string | null;
  readonly expertAwardMinor: string | null;
  readonly parties: { readonly customerUserId: string; readonly expertUserIds: readonly string[] };
  /** The record the dispute froze, and its current status. */
  readonly frozenRecord: { readonly entityType: LifecycleEntityType; readonly entityId: string; readonly status: string };
  readonly isOpen: boolean;
  readonly availableTriageEvents: readonly DisputeTriageEvent[];
  readonly triageHistory: readonly HistoryEntry[];
}

export async function getDispute(
  params: { readonly actor: Actor; readonly disputeId: string },
  db: Db = prisma,
): Promise<AdminDisputeDetail | null> {
  assertCapability(params.actor, 'DISPUTES_READ');
  if (!isUuid(params.disputeId)) return null;

  const dispute = await db.dispute.findUnique({
    where: { id: params.disputeId },
    select: {
      ...SUMMARY_SELECT,
      description: true,
      resolutionNotes: true,
      customerAwardMinor: true,
      expertAwardMinor: true,
      resolvedBy: { select: { id: true, fullName: true } },
      project: {
        select: {
          id: true,
          projectNumber: true,
          title: true,
          status: true,
          customer: { select: { userId: true } },
          contracts: { select: EXPERT_SIDE },
        },
      },
      contract: { select: { status: true } },
      milestone: { select: { status: true } },
    },
  });
  if (!dispute) return null;

  const level = disputeLevel(dispute);
  const frozenRecord =
    level === 'MILESTONE'
      ? { entityType: 'Milestone' as const, entityId: dispute.milestoneId!, status: dispute.milestone?.status ?? 'UNKNOWN' }
      : level === 'CONTRACT'
        ? { entityType: 'Contract' as const, entityId: dispute.contractId!, status: dispute.contract?.status ?? 'UNKNOWN' }
        : { entityType: 'Project' as const, entityId: dispute.project.id, status: dispute.project.status };

  const isOpen = (DISPUTE_OPEN_STATES as readonly string[]).includes(dispute.status);

  return {
    ...toSummary(dispute),
    description: dispute.description,
    resolutionNotes: dispute.resolutionNotes,
    resolvedBy: dispute.resolvedBy ? { userId: dispute.resolvedBy.id, fullName: dispute.resolvedBy.fullName } : null,
    customerAwardMinor: minor(dispute.customerAwardMinor),
    expertAwardMinor: minor(dispute.expertAwardMinor),
    parties: {
      customerUserId: dispute.project.customer.userId,
      expertUserIds: [...new Set(dispute.project.contracts.flatMap(expertSideUserIds))],
    },
    frozenRecord,
    isOpen,
    availableTriageEvents: availableEvents(DISPUTE_TRIAGE_MACHINE, dispute.status, 'HUMAN', {}),
    triageHistory: await auditHistory(db, 'Dispute', dispute.id, [AUDIT_ACTIONS.ADMIN_DISPUTE_TRANSITIONED]),
  };
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

interface DisputeRow {
  readonly id: string;
  readonly status: DisputeState;
  readonly raisedByUserId: string;
  readonly project: {
    readonly customer: { readonly userId: string };
    readonly contracts: readonly ExpertSide[];
  };
}

function partyUserIds(row: DisputeRow): string[] {
  return [row.raisedByUserId, row.project.customer.userId, ...row.project.contracts.flatMap(expertSideUserIds)];
}

const TRIAGE_SPEC: GovernedSpec<DisputeState, DisputeTriageEvent, DisputeTriageContext, DisputeRow, null> = {
  entityType: 'Dispute',
  table: 'disputes',
  machine: DISPUTE_TRIAGE_MACHINE,
  auditAction: AUDIT_ACTIONS.ADMIN_DISPUTE_TRANSITIONED,

  load: (tx, id) =>
    tx.dispute.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        raisedByUserId: true,
        project: { select: { customer: { select: { userId: true } }, contracts: { select: EXPERT_SIDE } } },
      },
    }),

  status: (row) => row.status,

  context: () => ({}),

  guard: async (_tx, row, _event, actor) => checkNotParty(actor, partyUserIds(row)),

  prepare: async () => null,

  async write({ tx, entity, from, to }) {
    const result = await tx.dispute.updateMany({ where: { id: entity.id, status: from }, data: { status: to } });
    return result.count;
  },

  effects: async () => ({}),
};

/** Begin review, request evidence, resume review, escalate, or return an escalation to review. */
export function triageDispute(request: GovernedRequest, db: Db = prisma): Promise<AdminOutcome> {
  return executeGovernedChange(TRIAGE_SPEC, request, db);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolveDisputeRequest {
  readonly actor: Actor;
  readonly disputeId: string;
  readonly resolution: DisputeResolution;
  /** The lifecycle's resolution notes, and the justification. */
  readonly notes: string;
  /** Project-level disputes only: end the engagement rather than restore the project. */
  readonly closeProject?: boolean | undefined;
  readonly confirm?: boolean | undefined;
  /** The dispute status the decider reviewed. */
  readonly expectedStatus?: DisputeState | undefined;
  readonly context?: RequestContext | undefined;
}

/**
 * Decide a dispute. HIGH risk: needs notes, `confirm: true` and the dispute
 * status that was reviewed. The decision itself is the lifecycle's.
 */
export async function resolveDispute(request: ResolveDisputeRequest, db: Db = prisma): Promise<AdminOutcome> {
  const base = { entityType: 'Dispute', entityId: request.disputeId, event: 'RESOLVE' };

  if (!isUuid(request.disputeId)) {
    return rejectedOutcome({ ...base, entityId: null }, new AdminRejection('NOT_FOUND', 'No dispute with that id.'));
  }

  const refuse = async (rejection: AdminRejection): Promise<AdminOutcome> => {
    await auditAdminDenial(db, {
      actor: request.actor,
      entityType: 'Dispute',
      entityId: request.disputeId,
      event: 'RESOLVE',
      rejection,
      risk: 'HIGH',
      financial: false,
      context: request.context,
    });
    return rejectedOutcome(base, rejection);
  };

  const decision = authorizeCapability(request.actor, 'DISPUTES_RESOLVE');
  if (!decision.allowed) {
    return refuse(new AdminRejection('FORBIDDEN', denialMessage(decision.reason, undefined), { denyReason: decision.reason }));
  }

  const failure = checkJustification('HIGH', {
    reason: request.notes,
    confirm: request.confirm,
    expectedStatus: request.expectedStatus,
  });
  if (failure) return refuse(new AdminRejection(failure.code, failure.message));

  const dispute = await db.dispute.findUnique({
    where: { id: request.disputeId },
    select: { id: true, status: true, projectId: true, contractId: true, milestoneId: true },
  });
  if (!dispute) return rejectedOutcome(base, new AdminRejection('NOT_FOUND', 'No dispute with that id.'));

  if (!(DISPUTE_OPEN_STATES as readonly string[]).includes(dispute.status)) {
    return rejectedOutcome(
      base,
      new AdminRejection('INVALID_TRANSITION', `This dispute is already ${dispute.status}.`, { status: dispute.status }),
    );
  }
  if (request.expectedStatus !== dispute.status) {
    return rejectedOutcome(
      base,
      new AdminRejection('CONFLICT', `Expected this dispute to be ${request.expectedStatus}, but it is ${dispute.status}.`, {
        status: dispute.status,
      }),
    );
  }

  const level = disputeLevel(dispute);
  if (request.closeProject && level !== 'PROJECT') {
    const rejection = precondition('"closeProject" applies only to a project-level dispute.');
    rejection.status = dispute.status;
    return refuse(rejection);
  }

  const target =
    level === 'MILESTONE'
      ? { entityType: 'Milestone' as const, entityId: dispute.milestoneId!, event: 'RESOLVE_DISPUTE' }
      : level === 'CONTRACT'
        ? { entityType: 'Contract' as const, entityId: dispute.contractId!, event: 'RESOLVE_DISPUTE' }
        : {
            entityType: 'Project' as const,
            entityId: dispute.projectId,
            event: request.closeProject ? 'RESOLVE_DISPUTE_CLOSE' : 'RESOLVE_DISPUTE',
          };

  return interveneInLifecycle(
    {
      ...target,
      actor: request.actor,
      reason: request.notes,
      confirm: true,
      // The frozen record must still be frozen by this dispute.
      expectedStatus: 'DISPUTED',
      params: { notes: request.notes.trim(), resolution: request.resolution },
      context: request.context,
    },
    db,
  );
}

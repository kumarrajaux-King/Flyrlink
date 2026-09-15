/**
 * Project lifecycle service — STEP 02 §10.1.
 *
 * The state machine (`domain/project/state-machine.ts`) says which transitions
 * exist. This service adds what they mean in context:
 *
 *   Business policy
 *     - APPROVE_ASSIGNMENT needs exactly one proposed assignment (or a named
 *       one) and invites that expert.
 *     - INVITE_DIRECT needs the invited expert and creates their invitation.
 *     - Expert responses act on the responding expert's own invitation.
 *     - ACTIVATE needs a milestone funded by a verified payment.
 *     - COMPLETE needs every binding contract complete.
 *
 *   Payment state — CANCEL ("any → CANCELLED")
 *     Refused while any payment on the project holds, moves or has disbursed
 *     money. Only CREATED, FAILED, CANCELLED and REFUNDED payments allow it; the
 *     money must be settled through a refund or a dispute first.
 *
 *   Contract state — CANCEL
 *     Refused while a signed contract binds the parties. Unsigned contracts,
 *     unfunded milestones, never-initiated payments and open assignments are
 *     withdrawn in the same transaction, so nothing is left dangling.
 *
 *   Dispute rules — RAISE_DISPUTE ("any → DISPUTED")
 *     A dispute needs a binding contract to dispute and a reason; only its
 *     parties may raise it; one open project-level dispute at a time. The
 *     dispute record is created with the transition.
 *
 *   Restoration — RESUME, RESOLVE_DISPUTE
 *     Return to the state held before the suspension or dispute, read from the
 *     audit trail.
 */

import type { Prisma } from '../../src/generated/prisma/client';
import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import { MILESTONE_FUNDED_OR_LATER } from '../../domain/milestone/state-machine';
import {
  PROJECT_MACHINE,
  PROJECT_STATES,
  type ProjectContext,
  type ProjectEvent,
  type ProjectState,
} from '../../domain/project/state-machine';
import {
  CONTRACT_EXPERT_SELECT,
  type CascadeResult,
  type DisputeResolution,
  type LifecycleSpec,
  OPEN_DISPUTE_STATUSES,
  PAYMENT_STATES_WITHOUT_FUNDS,
  type Participants,
  type TransitionParams,
  type TransitionScope,
  accountableUserId,
  assertSingleRow,
  cascadeRequired,
  contractExpertUserIds,
  isOneOf,
  isUuid,
  precondition,
  prepared,
  requireResolution,
  requireText,
  resolveOpenDisputes,
  statusBeforeEntering,
} from './engine';

const PROJECT_SELECT = {
  id: true,
  status: true,
  source: true,
  invitedExpertId: true,
  activatedAt: true,
  deletedAt: true,
  customer: { select: { userId: true } },
} as const satisfies Prisma.ProjectSelect;

export type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;

/** Contract states in which the terms bind both parties. A dispute needs one. */
const BINDING_CONTRACT_STATES = [
  'ACCEPTED',
  'FUNDED',
  'ACTIVE',
  'COMPLETED',
  'CLOSED',
  'DISPUTED',
  'TERMINATED',
] as const;

/** Signed contracts that have not ended. While one exists, the project cannot be cancelled. */
const CANCEL_BLOCKING_CONTRACT_STATES = ['ACCEPTED', 'FUNDED', 'ACTIVE', 'COMPLETED', 'CLOSED', 'DISPUTED'] as const;

/** Contracts still in progress, for COMPLETE. */
const OPEN_CONTRACT_STATES = ['ACCEPTED', 'FUNDED', 'ACTIVE', 'DISPUTED'] as const;

/** Unsigned contracts a cancellation withdraws. */
const WITHDRAWABLE_CONTRACT_STATES = ['DRAFT', 'SENT', 'NEGOTIATION'] as const;

/** Assignments a cancellation closes. */
const OPEN_ASSIGNMENT_STATES = ['DRAFT', 'PENDING_APPROVAL', 'INVITED', 'ACCEPTED'] as const;

/** Assignments whose expert is a participant in the project. */
const INVOLVED_ASSIGNMENT_STATES = ['INVITED', 'ACCEPTED', 'ACTIVE', 'COMPLETED'] as const;

const EXPERT_RESPONSES: readonly ProjectEvent[] = ['ACCEPT_ASSIGNMENT', 'DECLINE_ASSIGNMENT', 'DECLINE_INVITATION'];

interface Withdrawal {
  readonly paymentIds: readonly string[];
  readonly milestoneIds: readonly string[];
  readonly contractIds: readonly string[];
}

interface ProjectData {
  readonly assignmentId: string | null;
  readonly inviteExpertId: string | null;
  readonly withdraw: Withdrawal | null;
  readonly dispute: { readonly reason: string; readonly description: string } | null;
  readonly resolution: { readonly resolution: DisputeResolution; readonly notes: string } | null;
}

const NOTHING: ProjectData = {
  assignmentId: null,
  inviteExpertId: null,
  withdraw: null,
  dispute: null,
  resolution: null,
};

type Scope = TransitionScope<ProjectState, ProjectEvent, ProjectRow>;

function isProjectState(value: string | undefined): value is ProjectState {
  return value !== undefined && isOneOf(PROJECT_STATES, value);
}

/** Payments linked to a project through any of their order's references. */
function projectPayments(projectId: string): Prisma.PaymentWhereInput {
  return {
    order: {
      is: {
        OR: [
          { projectId },
          { milestone: { is: { projectId } } },
          { contract: { is: { projectId } } },
        ],
      },
    },
  };
}

async function prepareProject(scope: Scope): Promise<ProjectData> {
  const { tx, entity, event, params, request } = scope;

  switch (event) {
    case 'APPROVE_ASSIGNMENT': {
      if (params.assignmentId !== undefined && !isUuid(params.assignmentId)) {
        throw precondition('"assignmentId" is not a valid id.');
      }
      const candidates = await tx.assignment.findMany({
        where: {
          projectId: entity.id,
          status: { in: ['DRAFT', 'PENDING_APPROVAL'] },
          expertId: { not: null },
          ...(params.assignmentId ? { id: params.assignmentId } : {}),
        },
        select: { id: true },
        take: 2,
      });
      const [only, second] = candidates;
      if (!only) throw precondition('There is no proposed assignment to approve.');
      if (second) {
        throw precondition('Several assignments are proposed; name the one to approve with "assignmentId".');
      }
      return { ...NOTHING, assignmentId: only.id };
    }

    case 'INVITE_DIRECT': {
      if (!entity.invitedExpertId) {
        throw precondition('A direct hire needs the invited expert to be set on the project.');
      }
      const existing = await tx.assignment.findFirst({
        where: {
          projectId: entity.id,
          expertId: entity.invitedExpertId,
          status: { in: ['DRAFT', 'PENDING_APPROVAL', 'INVITED'] },
        },
        select: { id: true },
      });
      return { ...NOTHING, assignmentId: existing?.id ?? null, inviteExpertId: entity.invitedExpertId };
    }

    case 'ACCEPT_ASSIGNMENT':
    case 'DECLINE_ASSIGNMENT':
    case 'DECLINE_INVITATION': {
      const userId = accountableUserId(request.actor);
      const invitation = userId
        ? await tx.assignment.findFirst({
            where: { projectId: entity.id, status: 'INVITED', expert: { is: { userId } } },
            select: { id: true },
          })
        : null;
      if (!invitation) throw precondition('You have no pending invitation on this project.');
      return { ...NOTHING, assignmentId: invitation.id };
    }

    case 'ACTIVATE': {
      const funded = await tx.milestone.count({
        where: { projectId: entity.id, status: { in: [...MILESTONE_FUNDED_OR_LATER] } },
      });
      if (funded === 0) {
        throw precondition('No milestone on this project has been funded by a verified payment.');
      }
      return NOTHING;
    }

    case 'COMPLETE': {
      const contracts = await tx.contract.findMany({
        where: { projectId: entity.id },
        select: { status: true },
      });
      const open = contracts.some((contract) => isOneOf(OPEN_CONTRACT_STATES, contract.status));
      const done = contracts.some((contract) => contract.status === 'COMPLETED' || contract.status === 'CLOSED');
      if (open || !done) {
        throw precondition('A project completes when every binding contract on it is complete.');
      }
      return NOTHING;
    }

    case 'CANCEL': {
      // Payment state: money that is held, moving or paid out is never
      // abandoned by a status change. It is settled first.
      const payments = await tx.payment.findMany({
        where: projectPayments(entity.id),
        select: { id: true, status: true },
      });
      const holding = payments.filter((payment) => !isOneOf(PAYMENT_STATES_WITHOUT_FUNDS, payment.status));
      if (holding.length > 0) {
        const states = [...new Set(holding.map((payment) => payment.status))].join(', ');
        throw precondition(
          `This project has money in flight, in escrow or paid out (${states}). Settle it through a ` +
            'refund or a dispute before cancelling.',
        );
      }

      // Contract state: signed terms are ended by termination or completion,
      // never by cancelling the project around them.
      const contracts = await tx.contract.findMany({
        where: { projectId: entity.id },
        select: { id: true, status: true },
      });
      const binding = contracts.filter((contract) => isOneOf(CANCEL_BLOCKING_CONTRACT_STATES, contract.status));
      if (binding.length > 0) {
        const states = [...new Set(binding.map((contract) => contract.status))].join(', ');
        throw precondition(
          `A signed contract still binds the parties (${states}). Terminate or complete it before cancelling.`,
        );
      }

      const milestones = await tx.milestone.findMany({
        where: { projectId: entity.id, status: { in: ['DRAFT', 'PENDING_FUNDING'] } },
        select: { id: true },
      });

      return {
        ...NOTHING,
        withdraw: {
          paymentIds: payments.filter((payment) => payment.status === 'CREATED').map((payment) => payment.id),
          milestoneIds: milestones.map((milestone) => milestone.id),
          contractIds: contracts
            .filter((contract) => isOneOf(WITHDRAWABLE_CONTRACT_STATES, contract.status))
            .map((contract) => contract.id),
        },
      };
    }

    case 'RAISE_DISPUTE': {
      const reason = requireText(params.reason, 'reason', event);
      const description = requireText(params.description, 'description', event);

      const binding = await tx.contract.count({
        where: { projectId: entity.id, status: { in: [...BINDING_CONTRACT_STATES] } },
      });
      if (binding === 0) {
        throw precondition('A dispute needs a signed contract between the parties, and this project has none.');
      }

      const open = await tx.dispute.count({
        where: {
          projectId: entity.id,
          contractId: null,
          milestoneId: null,
          status: { in: [...OPEN_DISPUTE_STATUSES] },
        },
      });
      if (open > 0) throw precondition('This project already has an open dispute.');

      return { ...NOTHING, dispute: { reason, description } };
    }

    case 'RESOLVE_DISPUTE':
    case 'RESOLVE_DISPUTE_CLOSE':
      return {
        ...NOTHING,
        resolution: {
          resolution: requireResolution(params, event),
          notes: requireText(params.notes, 'notes', event),
        },
      };

    default:
      return NOTHING;
  }
}

function projectColumns(
  event: ProjectEvent,
  entity: ProjectRow,
  params: TransitionParams,
  now: Date,
): Prisma.ProjectUpdateManyMutationInput {
  switch (event) {
    case 'SUBMIT':
      return { submittedAt: now };
    case 'ACTIVATE':
      return { activatedAt: entity.activatedAt ?? now };
    case 'MARK_AT_RISK':
      return { riskLevel: params.riskLevel ?? 'MEDIUM' };
    case 'RESOLVE_RISK':
      return { riskLevel: 'NONE' };
    case 'COMPLETE':
      return { completedAt: now };
    case 'CLOSE':
    case 'RESOLVE_DISPUTE_CLOSE':
      return { closedAt: now };
    default:
      return {};
  }
}

async function projectEffects(scope: Scope, data: ProjectData): Promise<Record<string, unknown>> {
  const { tx, entity, event, params, now, request } = scope;
  const userId = accountableUserId(request.actor);
  const facts: Record<string, unknown> = params.reason ? { reason: params.reason } : {};

  switch (event) {
    case 'APPROVE_ASSIGNMENT': {
      const assignmentId = prepared(data.assignmentId, 'assignmentId');
      const updated = await tx.assignment.updateMany({
        where: { id: assignmentId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } },
        data: { status: 'INVITED', invitedAt: now, approvedByUserId: userId, approvedAt: now },
      });
      assertSingleRow(updated.count, 'assignment');
      return { ...facts, assignmentId };
    }

    case 'INVITE_DIRECT': {
      if (data.assignmentId) {
        const updated = await tx.assignment.updateMany({
          where: { id: data.assignmentId, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'INVITED'] } },
          data: { status: 'INVITED', invitedAt: now },
        });
        assertSingleRow(updated.count, 'assignment');
        return { ...facts, assignmentId: data.assignmentId };
      }
      const created = await tx.assignment.create({
        data: {
          projectId: entity.id,
          expertId: prepared(data.inviteExpertId, 'inviteExpertId'),
          status: 'INVITED',
          invitedAt: now,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      return { ...facts, assignmentId: created.id };
    }

    case 'ACCEPT_ASSIGNMENT': {
      const assignmentId = prepared(data.assignmentId, 'assignmentId');
      const updated = await tx.assignment.updateMany({
        where: { id: assignmentId, status: 'INVITED' },
        data: { status: 'ACCEPTED', respondedAt: now },
      });
      assertSingleRow(updated.count, 'assignment');
      return { ...facts, assignmentId };
    }

    case 'DECLINE_ASSIGNMENT':
    case 'DECLINE_INVITATION': {
      const assignmentId = prepared(data.assignmentId, 'assignmentId');
      const updated = await tx.assignment.updateMany({
        where: { id: assignmentId, status: 'INVITED' },
        data: { status: 'DECLINED', respondedAt: now, declineReason: params.reason?.trim() || null },
      });
      assertSingleRow(updated.count, 'assignment');
      return { ...facts, assignmentId };
    }

    case 'MARK_AT_RISK':
      return { ...facts, riskLevel: params.riskLevel ?? 'MEDIUM' };

    case 'RAISE_DISPUTE': {
      const dispute = prepared(data.dispute, 'dispute');
      const created = await tx.dispute.create({
        data: {
          projectId: entity.id,
          raisedByUserId: prepared(userId, 'raisedByUserId'),
          reason: dispute.reason,
          description: dispute.description,
        },
        select: { id: true },
      });
      return { ...facts, disputeId: created.id };
    }

    case 'RESOLVE_DISPUTE':
    case 'RESOLVE_DISPUTE_CLOSE': {
      const resolution = prepared(data.resolution, 'resolution');
      const resolved = await resolveOpenDisputes(
        tx,
        { projectId: entity.id, contractId: null, milestoneId: null },
        resolution.resolution,
        resolution.notes,
        userId,
        now,
      );
      return { ...facts, resolution: resolution.resolution, disputesResolved: resolved };
    }

    case 'CANCEL': {
      const closed = await tx.assignment.updateMany({
        where: { projectId: entity.id, status: { in: [...OPEN_ASSIGNMENT_STATES] } },
        data: { status: 'CANCELLED' },
      });
      return { ...facts, assignmentsCancelled: closed.count };
    }

    default:
      return facts;
  }
}

async function projectCascades(scope: Scope, data: ProjectData): Promise<readonly CascadeResult[]> {
  if (scope.event !== 'CANCEL') return [];
  const withdraw = prepared(data.withdraw, 'withdraw');

  // Required: a cancellation that cannot withdraw everything must not commit.
  const results: CascadeResult[] = [];
  for (const entityId of withdraw.paymentIds) {
    results.push(await cascadeRequired(scope, { entityType: 'Payment', entityId, event: 'CANCEL' }));
  }
  for (const entityId of withdraw.milestoneIds) {
    results.push(await cascadeRequired(scope, { entityType: 'Milestone', entityId, event: 'CANCEL' }));
  }
  for (const entityId of withdraw.contractIds) {
    results.push(await cascadeRequired(scope, { entityType: 'Contract', entityId, event: 'CANCEL' }));
  }
  return results;
}

async function projectParticipants(
  tx: Scope['tx'],
  project: ProjectRow,
  event: ProjectEvent,
): Promise<Participants> {
  const customerUserId = project.customer.userId;

  // Responding to an invitation is for the invited expert alone.
  if (EXPERT_RESPONSES.includes(event)) {
    const invited = await tx.assignment.findMany({
      where: { projectId: project.id, status: 'INVITED' },
      select: { expert: { select: { userId: true } } },
    });
    return {
      customerUserId,
      expertUserIds: invited.flatMap((assignment) => (assignment.expert ? [assignment.expert.userId] : [])),
    };
  }

  // A dispute is between the parties to a binding contract.
  const disputing = event === 'RAISE_DISPUTE';
  const contracts = await tx.contract.findMany({
    where: {
      projectId: project.id,
      ...(disputing ? { status: { in: [...BINDING_CONTRACT_STATES] } } : {}),
    },
    select: CONTRACT_EXPERT_SELECT,
  });
  const experts = new Set(contracts.flatMap(contractExpertUserIds));

  if (!disputing) {
    const assignments = await tx.assignment.findMany({
      where: { projectId: project.id, status: { in: [...INVOLVED_ASSIGNMENT_STATES] } },
      select: { expert: { select: { userId: true } } },
    });
    for (const assignment of assignments) {
      if (assignment.expert) experts.add(assignment.expert.userId);
    }
  }

  return { customerUserId, expertUserIds: [...experts] };
}

export const PROJECT_LIFECYCLE: LifecycleSpec<
  ProjectState,
  ProjectEvent,
  ProjectContext,
  ProjectRow,
  ProjectData
> = {
  entityType: 'Project',
  table: 'projects',
  machine: PROJECT_MACHINE,
  auditAction: AUDIT_ACTIONS.PROJECT_TRANSITIONED,

  async load(tx, id) {
    const project = await tx.project.findUnique({ where: { id }, select: PROJECT_SELECT });
    // A soft-deleted project has no lifecycle.
    return project && project.deletedAt === null ? project : null;
  },

  status: (project) => project.status,

  participants: projectParticipants,

  async context(tx, project, event) {
    if (event !== 'RESUME' && event !== 'RESOLVE_DISPUTE') return { source: project.source };
    const previous = await statusBeforeEntering(tx, {
      entityType: 'Project',
      entityId: project.id,
      action: AUDIT_ACTIONS.PROJECT_TRANSITIONED,
      enteredStatus: event === 'RESUME' ? 'SUSPENDED' : 'DISPUTED',
    });
    return { source: project.source, previousStatus: isProjectState(previous) ? previous : undefined };
  },

  prepare: prepareProject,

  async write({ tx, entity, event, from, to, params, now }) {
    const result = await tx.project.updateMany({
      where: { id: entity.id, status: from },
      data: { status: to, ...projectColumns(event, entity, params, now) },
    });
    return result.count;
  },

  effects: projectEffects,
  cascades: projectCascades,
};

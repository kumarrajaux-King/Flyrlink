/**
 * Milestone lifecycle service — STEP 02 §10.3.
 *
 * Contextual rules on top of the state machine:
 *
 *   Payment state
 *     - MARK_FUNDED needs a webhook-confirmed payment on this milestone for at
 *       least its amount, in its currency. An underpayment never funds work.
 *     - CANCEL is refused while a payment on the milestone is in flight or
 *       captured; never-initiated payments are withdrawn with it.
 *     - CANCEL_FUNDED needs the escrowed money already in the refund flow, so a
 *       cancelled milestone never strands funds.
 *
 *   Business policy
 *     - OPEN_FOR_FUNDING needs signed contract terms.
 *     - SUBMIT needs at least one submitted deliverable.
 *     - Review decisions carry the deliverables with them.
 *
 *   Dispute rules
 *     - RAISE_DISPUTE needs a reason and one open milestone dispute at a time.
 *
 * Cascades: funding funds the contract and activates the project; starting
 * starts the contract; approval requests escrow release and lets the contract
 * (and then the project) complete.
 */

import type { Prisma } from '../../src/generated/prisma/client';
import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import {
  MILESTONE_MACHINE,
  type MilestoneContext,
  type MilestoneEvent,
  type MilestoneState,
} from '../../domain/milestone/state-machine';
import {
  CONTRACT_EXPERT_SELECT,
  type CascadeResult,
  type DisputeResolution,
  type LifecycleSpec,
  OPEN_DISPUTE_STATUSES,
  PAYMENT_STATES_WITHOUT_FUNDS,
  type TransitionScope,
  accountableUserId,
  cascade,
  cascadeRequired,
  contractExpertUserIds,
  isOneOf,
  precondition,
  prepared,
  requireResolution,
  requireText,
  resolveOpenDisputes,
} from './engine';

const MILESTONE_SELECT = {
  id: true,
  status: true,
  contractId: true,
  projectId: true,
  amountMinor: true,
  currency: true,
  startedAt: true,
  contract: {
    select: {
      status: true,
      customer: { select: { userId: true } },
      ...CONTRACT_EXPERT_SELECT,
    },
  },
} as const satisfies Prisma.MilestoneSelect;

export type MilestoneRow = Prisma.MilestoneGetPayload<{ select: typeof MILESTONE_SELECT }>;

/** Contract states under which terms are signed and funding may be taken. */
const FUNDABLE_CONTRACT_STATES = ['ACCEPTED', 'FUNDED', 'ACTIVE'] as const;

/** Payment states in which a funded milestone's money is already on its way back. */
const PAYMENT_STATES_IN_REFUND = ['REFUND_REQUESTED', 'REFUNDED', 'FAILED', 'CANCELLED', 'CHARGEBACK'] as const;

interface MilestoneData {
  readonly paymentId: string | null;
  readonly createdPaymentIds: readonly string[];
  readonly dispute: { readonly reason: string; readonly description: string } | null;
  readonly resolution: { readonly resolution: DisputeResolution; readonly notes: string } | null;
}

const NOTHING: MilestoneData = { paymentId: null, createdPaymentIds: [], dispute: null, resolution: null };

type Scope = TransitionScope<MilestoneState, MilestoneEvent, MilestoneRow>;

function milestonePayments(milestoneId: string): Prisma.PaymentWhereInput {
  return { order: { is: { milestoneId } } };
}

async function prepareMilestone(scope: Scope): Promise<MilestoneData> {
  const { tx, entity, event, params } = scope;

  switch (event) {
    case 'OPEN_FOR_FUNDING':
      if (!isOneOf(FUNDABLE_CONTRACT_STATES, entity.contract.status)) {
        throw precondition('A milestone can be opened for funding only under signed contract terms.');
      }
      return NOTHING;

    case 'MARK_FUNDED': {
      const payments = await tx.payment.findMany({
        where: {
          ...milestonePayments(entity.id),
          status: { in: ['SUCCEEDED', 'FUNDS_ALLOCATED'] },
          // Only a payment a verified webhook confirmed counts as money.
          confirmedByWebhookEventId: { not: null },
        },
        select: { id: true, amountMinor: true, refundedAmountMinor: true, currency: true },
      });
      const covering = payments.find(
        (payment) =>
          payment.currency === entity.currency &&
          payment.amountMinor - payment.refundedAmountMinor >= entity.amountMinor,
      );
      if (!covering) {
        throw precondition("No webhook-confirmed payment covers this milestone's amount in its currency.");
      }
      return { ...NOTHING, paymentId: covering.id };
    }

    case 'SUBMIT': {
      const submitted = await tx.deliverable.count({
        where: { milestoneId: entity.id, status: 'SUBMITTED' },
      });
      if (submitted === 0) throw precondition('Submit at least one deliverable before submitting the milestone.');
      return NOTHING;
    }

    case 'RAISE_DISPUTE': {
      const reason = requireText(params.reason, 'reason', event);
      const description = requireText(params.description, 'description', event);
      const open = await tx.dispute.count({
        where: { milestoneId: entity.id, status: { in: [...OPEN_DISPUTE_STATUSES] } },
      });
      if (open > 0) throw precondition('This milestone already has an open dispute.');
      return { ...NOTHING, dispute: { reason, description } };
    }

    case 'RESOLVE_DISPUTE':
      return {
        ...NOTHING,
        resolution: {
          resolution: requireResolution(params, event),
          notes: requireText(params.notes, 'notes', event),
        },
      };

    case 'CANCEL': {
      const payments = await tx.payment.findMany({
        where: milestonePayments(entity.id),
        select: { id: true, status: true },
      });
      if (payments.some((payment) => !isOneOf(PAYMENT_STATES_WITHOUT_FUNDS, payment.status))) {
        throw precondition('A payment on this milestone is in flight or captured; it cannot be cancelled now.');
      }
      return {
        ...NOTHING,
        createdPaymentIds: payments.filter((payment) => payment.status === 'CREATED').map((payment) => payment.id),
      };
    }

    case 'CANCEL_FUNDED': {
      const payments = await tx.payment.findMany({
        where: milestonePayments(entity.id),
        select: { status: true },
      });
      if (payments.some((payment) => !isOneOf(PAYMENT_STATES_IN_REFUND, payment.status))) {
        throw precondition('Put the escrowed funds into the refund flow before cancelling a funded milestone.');
      }
      return NOTHING;
    }

    default:
      return NOTHING;
  }
}

function milestoneColumns(
  event: MilestoneEvent,
  entity: MilestoneRow,
  now: Date,
): Prisma.MilestoneUpdateManyMutationInput {
  switch (event) {
    case 'MARK_FUNDED':
      return { fundedAt: now };
    case 'START':
      return { startedAt: entity.startedAt ?? now };
    case 'SUBMIT':
      return { submittedAt: now };
    case 'APPROVE':
      return { approvedAt: now };
    case 'REQUEST_REVISION':
      // Incremented only by an applied transition, so a repeated request —
      // which is a NO_OP — cannot inflate the performance signal.
      return { revisionCount: { increment: 1 } };
    default:
      return {};
  }
}

async function milestoneEffects(scope: Scope, data: MilestoneData): Promise<Record<string, unknown>> {
  const { tx, entity, event, params, now, request } = scope;
  const userId = accountableUserId(request.actor);
  const facts: Record<string, unknown> = params.reason ? { reason: params.reason } : {};

  switch (event) {
    case 'MARK_FUNDED':
      return { ...facts, paymentId: prepared(data.paymentId, 'paymentId') };

    case 'BEGIN_REVIEW': {
      const opened = await tx.deliverable.updateMany({
        where: { milestoneId: entity.id, status: 'SUBMITTED' },
        data: { status: 'IN_REVIEW' },
      });
      return { ...facts, deliverablesInReview: opened.count };
    }

    case 'APPROVE':
    case 'REQUEST_REVISION': {
      const approving = event === 'APPROVE';
      const reviewed = await tx.deliverable.updateMany({
        where: { milestoneId: entity.id, status: 'IN_REVIEW' },
        data: {
          status: approving ? 'APPROVED' : 'REVISION_REQUESTED',
          reviewedByUserId: userId,
          reviewedAt: now,
          ...(approving ? {} : { reviewNotes: params.reason?.trim() || null }),
        },
      });
      return { ...facts, deliverablesReviewed: reviewed.count };
    }

    case 'RAISE_DISPUTE': {
      const dispute = prepared(data.dispute, 'dispute');
      const created = await tx.dispute.create({
        data: {
          projectId: entity.projectId,
          contractId: entity.contractId,
          milestoneId: entity.id,
          raisedByUserId: prepared(userId, 'raisedByUserId'),
          reason: dispute.reason,
          description: dispute.description,
        },
        select: { id: true },
      });
      return { ...facts, disputeId: created.id };
    }

    case 'RESOLVE_DISPUTE': {
      const resolution = prepared(data.resolution, 'resolution');
      const resolved = await resolveOpenDisputes(
        tx,
        { projectId: entity.projectId, contractId: entity.contractId, milestoneId: entity.id },
        resolution.resolution,
        resolution.notes,
        userId,
        now,
      );
      return { ...facts, resolution: resolution.resolution, disputesResolved: resolved };
    }

    default:
      return facts;
  }
}

async function milestoneCascades(scope: Scope, data: MilestoneData): Promise<readonly CascadeResult[]> {
  const { entity } = scope;
  const completeContract = () =>
    cascade(scope, { entityType: 'Contract', entityId: entity.contractId, event: 'COMPLETE' });

  switch (scope.event) {
    case 'MARK_FUNDED':
      return [
        await cascade(scope, { entityType: 'Contract', entityId: entity.contractId, event: 'MARK_FUNDED' }),
        await cascade(scope, { entityType: 'Project', entityId: entity.projectId, event: 'ACTIVATE' }),
      ];

    case 'START':
      return [await cascade(scope, { entityType: 'Contract', entityId: entity.contractId, event: 'START' })];

    case 'APPROVE': {
      // Approval makes escrow release-eligible; release itself stays a
      // finance-only human decision.
      const held = await scope.tx.payment.findMany({
        where: { ...milestonePayments(entity.id), status: 'FUNDS_ALLOCATED' },
        select: { id: true },
      });
      const results: CascadeResult[] = [];
      for (const payment of held) {
        results.push(await cascade(scope, { entityType: 'Payment', entityId: payment.id, event: 'REQUEST_RELEASE' }));
      }
      results.push(await completeContract());
      return results;
    }

    case 'CANCEL': {
      const results: CascadeResult[] = [];
      for (const entityId of data.createdPaymentIds) {
        results.push(await cascadeRequired(scope, { entityType: 'Payment', entityId, event: 'CANCEL' }));
      }
      results.push(await completeContract());
      return results;
    }

    case 'RESOLVE_DISPUTE':
    case 'CANCEL_FUNDED':
      return [await completeContract()];

    default:
      return [];
  }
}

export const MILESTONE_LIFECYCLE: LifecycleSpec<
  MilestoneState,
  MilestoneEvent,
  MilestoneContext,
  MilestoneRow,
  MilestoneData
> = {
  entityType: 'Milestone',
  table: 'milestones',
  machine: MILESTONE_MACHINE,
  auditAction: AUDIT_ACTIONS.MILESTONE_TRANSITIONED,

  load: (tx, id) => tx.milestone.findUnique({ where: { id }, select: MILESTONE_SELECT }),

  status: (milestone) => milestone.status,

  async participants(_tx, milestone) {
    return {
      customerUserId: milestone.contract.customer.userId,
      expertUserIds: contractExpertUserIds(milestone.contract),
    };
  },

  context: async () => ({}),

  prepare: prepareMilestone,

  async write({ tx, entity, event, from, to, now }) {
    const result = await tx.milestone.updateMany({
      where: { id: entity.id, status: from },
      data: { status: to, ...milestoneColumns(event, entity, now) },
    });
    return result.count;
  },

  effects: milestoneEffects,
  cascades: milestoneCascades,
};

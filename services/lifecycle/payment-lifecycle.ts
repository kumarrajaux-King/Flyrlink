/**
 * Payment lifecycle service — STEP 02 §10.4.
 *
 * "Only a verified webhook may advance a payment to SUCCEEDED. No client call,
 * no redirect, no admin action substitutes for it." The state machine makes
 * CONFIRM_SUCCEEDED (and refund confirmation and chargebacks) WEBHOOK-only.
 * This service then verifies the webhook itself:
 *
 *   - the event exists and its signature was verified on receipt;
 *   - it comes from this payment's provider;
 *   - it has not already been applied — to this payment or any other.
 *
 * Other contextual rules:
 *
 *   - INITIATE needs the funded milestone to be awaiting funding.
 *   - A payment the gateway has acknowledged (PENDING) can only be settled by
 *     the gateway; a customer cannot cancel it out from under a capture.
 *   - ALLOCATE_FUNDS needs webhook-confirmed capture.
 *   - REQUEST_RELEASE and RELEASE need the funded milestone approved, and
 *     RELEASE is refused while any dispute on the project is open.
 *   - Refund requests and rejections need a reason; a partial refund must be
 *     a real, increasing, partial amount.
 *
 * Money amounts are only ever written from provider-reported values, and the
 * database CHECK constraints still bound them.
 */

import type { Prisma } from '../../src/generated/prisma/client';
import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import {
  PAYMENT_MACHINE,
  type PaymentContext,
  type PaymentEvent,
  type PaymentState,
} from '../../domain/payment/state-machine';
import {
  type CascadeResult,
  type LifecycleSpec,
  LifecycleRejection,
  OPEN_DISPUTE_STATUSES,
  type TransitionScope,
  cascade,
  isUuid,
  precondition,
  prepared,
  requireText,
} from './engine';

const PAYMENT_SELECT = {
  id: true,
  status: true,
  provider: true,
  amountMinor: true,
  refundedAmountMinor: true,
  currency: true,
  confirmedByWebhookEventId: true,
  customer: { select: { userId: true } },
  order: {
    select: {
      id: true,
      projectId: true,
      milestoneId: true,
      milestone: { select: { status: true, projectId: true } },
    },
  },
} as const satisfies Prisma.PaymentSelect;

export type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

interface PaymentData {
  readonly webhookEventId: string | null;
  readonly refundedAmountMinor: bigint | null;
}

const NOTHING: PaymentData = { webhookEventId: null, refundedAmountMinor: null };

type Scope = TransitionScope<PaymentState, PaymentEvent, PaymentRow>;

function webhookRejected(message: string): LifecycleRejection {
  return new LifecycleRejection('WEBHOOK_REJECTED', message);
}

function truncate(value: string | undefined, length: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, length) : null;
}

/** Verify the webhook behind a WEBHOOK-actor transition. */
async function verifyWebhook(scope: Scope, webhookEventId: string): Promise<string> {
  const { tx, entity } = scope;

  if (!isUuid(webhookEventId)) throw webhookRejected('The webhook event reference is malformed.');

  const event = await tx.webhookEvent.findUnique({
    where: { id: webhookEventId },
    select: { id: true, provider: true, signatureVerified: true },
  });
  if (!event) throw webhookRejected('The webhook event does not exist.');
  if (!event.signatureVerified) throw webhookRejected('The webhook event did not pass signature verification.');
  if (event.provider !== entity.provider) {
    throw webhookRejected("The webhook event is from a different provider than this payment's.");
  }

  // One provider event attests to one fact. Replaying it — against this payment
  // or another — is refused, whether it confirmed a capture or anything else.
  const boundElsewhere = await tx.payment.count({
    where: { confirmedByWebhookEventId: event.id, id: { not: entity.id } },
  });
  const alreadyApplied = await tx.auditLog.count({
    where: {
      action: AUDIT_ACTIONS.PAYMENT_TRANSITIONED,
      afterState: { path: ['webhookEventId'], equals: event.id },
    },
  });
  if (boundElsewhere > 0 || alreadyApplied > 0) {
    throw webhookRejected('This webhook event has already been applied.');
  }

  return event.id;
}

function milestoneApproved(entity: PaymentRow): void {
  if (!entity.order.milestoneId || !entity.order.milestone) {
    throw precondition('Escrow release is defined for milestone-funded payments.');
  }
  if (entity.order.milestone.status !== 'APPROVED') {
    throw precondition('Escrow is released only for an approved milestone.');
  }
}

async function preparePayment(scope: Scope): Promise<PaymentData> {
  const { tx, entity, event, params, request, from } = scope;

  const webhookEventId =
    request.actor.kind === 'WEBHOOK' ? await verifyWebhook(scope, request.actor.webhookEventId) : null;
  const data: PaymentData = { ...NOTHING, webhookEventId };

  switch (event) {
    case 'INITIATE':
      if (entity.order.milestoneId && entity.order.milestone?.status !== 'PENDING_FUNDING') {
        throw precondition('The milestone this payment funds is not awaiting funding.');
      }
      return data;

    case 'CANCEL':
      if (request.actor.kind === 'HUMAN' && from === 'PENDING') {
        throw precondition('The gateway has acknowledged this payment; only its outcome can settle it now.');
      }
      return data;

    case 'ALLOCATE_FUNDS':
      if (!entity.confirmedByWebhookEventId) {
        throw precondition('Funds are allocated only after a webhook-confirmed capture.');
      }
      return data;

    case 'REQUEST_RELEASE':
      milestoneApproved(entity);
      return data;

    case 'RELEASE': {
      milestoneApproved(entity);
      const projectId = entity.order.milestone?.projectId ?? entity.order.projectId;
      const open = projectId
        ? await tx.dispute.count({ where: { projectId, status: { in: [...OPEN_DISPUTE_STATUSES] } } })
        : 0;
      if (open > 0) throw precondition('Escrow cannot be released while a dispute on this project is open.');
      return data;
    }

    case 'REQUEST_REFUND':
    case 'REJECT_REFUND':
      requireText(params.reason, 'reason', event);
      return data;

    case 'CONFIRM_PARTIAL_REFUND': {
      const amount = params.refundedAmountMinor;
      if (amount === undefined) throw precondition('A partial refund needs the refunded amount.');
      if (amount <= entity.refundedAmountMinor || amount >= entity.amountMinor) {
        throw precondition('A partial refund must exceed what was already refunded and stay below the payment amount.');
      }
      return { ...data, refundedAmountMinor: amount };
    }

    default:
      return data;
  }
}

function paymentColumns(
  event: PaymentEvent,
  entity: PaymentRow,
  params: Scope['params'],
  data: PaymentData,
  now: Date,
): Prisma.PaymentUncheckedUpdateManyInput {
  switch (event) {
    case 'INITIATE':
      return { initiatedAt: now };
    case 'CONFIRM_SUCCEEDED':
      // The webhook that authorised SUCCEEDED is recorded on the row itself.
      return { capturedAt: now, confirmedByWebhookEventId: prepared(data.webhookEventId, 'webhookEventId') };
    case 'MARK_FAILED':
      return {
        failedAt: now,
        failureCode: truncate(params.failureCode, 100),
        failureMessage: truncate(params.failureMessage, 500),
      };
    case 'CONFIRM_REFUNDED':
      return { refundedAmountMinor: entity.amountMinor };
    case 'CONFIRM_PARTIAL_REFUND':
      return { refundedAmountMinor: prepared(data.refundedAmountMinor, 'refundedAmountMinor') };
    default:
      return {};
  }
}

async function paymentEffects(scope: Scope, data: PaymentData): Promise<Record<string, unknown>> {
  const { tx, entity, event, params, now } = scope;
  const facts: Record<string, unknown> = params.reason ? { reason: params.reason } : {};

  switch (event) {
    case 'CONFIRM_SUCCEEDED': {
      const paid = await tx.order.updateMany({
        where: { id: entity.order.id, status: { in: ['CREATED', 'AWAITING_PAYMENT'] } },
        data: { status: 'PAID', paidAt: now },
      });
      return { ...facts, orderPaid: paid.count === 1 };
    }
    case 'CONFIRM_REFUNDED':
      return { ...facts, refundedAmountMinor: entity.amountMinor.toString() };
    case 'CONFIRM_PARTIAL_REFUND':
      return { ...facts, refundedAmountMinor: prepared(data.refundedAmountMinor, 'refundedAmountMinor').toString() };
    case 'MARK_FAILED':
      return { ...facts, failureCode: truncate(params.failureCode, 100) };
    default:
      return facts;
  }
}

async function paymentCascades(scope: Scope): Promise<readonly CascadeResult[]> {
  if (scope.event !== 'CONFIRM_SUCCEEDED') return [];

  // Captured money goes to escrow, then funds the milestone it was for — which
  // funds the contract and activates the project.
  const results: CascadeResult[] = [
    await cascade(scope, { entityType: 'Payment', entityId: scope.entity.id, event: 'ALLOCATE_FUNDS' }),
  ];
  const milestoneId = scope.entity.order.milestoneId;
  if (milestoneId) {
    results.push(await cascade(scope, { entityType: 'Milestone', entityId: milestoneId, event: 'MARK_FUNDED' }));
  }
  return results;
}

export const PAYMENT_LIFECYCLE: LifecycleSpec<
  PaymentState,
  PaymentEvent,
  PaymentContext,
  PaymentRow,
  PaymentData
> = {
  entityType: 'Payment',
  table: 'payments',
  machine: PAYMENT_MACHINE,
  auditAction: AUDIT_ACTIONS.PAYMENT_TRANSITIONED,

  load: (tx, id) => tx.payment.findUnique({ where: { id }, select: PAYMENT_SELECT }),

  status: (payment) => payment.status,

  // Experts never act on a payment: every human payment event is the
  // customer's (own) or finance's (any).
  async participants(_tx, payment) {
    return { customerUserId: payment.customer.userId, expertUserIds: [] };
  },

  context: async () => ({}),

  prepare: preparePayment,

  async write({ tx, entity, event, from, to, params, now }, data) {
    const result = await tx.payment.updateMany({
      where: { id: entity.id, status: from },
      data: { status: to, ...paymentColumns(event, entity, params, data, now) },
    });
    return result.count;
  },

  effects: paymentEffects,
  cascades: paymentCascades,

  // A redelivered capture webhook. The payment has already moved past
  // SUCCEEDED into escrow, but this exact event is the one that confirmed it,
  // so the delivery is a repeat — not an invalid transition, and never a
  // second capture.
  isRepeat: (payment, request) =>
    request.event === 'CONFIRM_SUCCEEDED' &&
    request.actor.kind === 'WEBHOOK' &&
    payment.confirmedByWebhookEventId === request.actor.webhookEventId,
};

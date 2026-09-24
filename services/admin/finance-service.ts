/**
 * Finance oversight (Phase 8): payments, the ledger, refunds and payouts.
 *
 * Read-only by construction, with two exceptions. Both are human, both are
 * audited, and neither can move money on its own:
 *
 *   - Payment interventions — escrow RELEASE, refund request and rejection — go
 *     through `interveneInLifecycle` into the Phase 6 payment lifecycle, where
 *     RELEASE stays finance-only, MFA-gated, CRITICAL, and blocked while any
 *     dispute on the project is open.
 *   - Payout decisions — approve, hold, release a hold, cancel — change a
 *     payout's authorisation state. Processing and settlement are
 *     provider-attested (Phase 10) and unreachable from here.
 *
 * Nothing in this file writes a ledger entry, a transaction, a balance or an
 * amount. The ledger is append-only and posted by the payment pipeline; the
 * summary here only sums it.
 */

import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import { assertCapability, checkNotParty, hasCapability } from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import type { LEDGER_ACCOUNTS, PAYMENT_PROVIDERS, REFUND_STATUSES } from '../../lib/validation/admin';
import { DISPUTE_OPEN_STATES } from '../../domain/dispute/triage-machine';
import { availableEvents } from '../../domain/lifecycle/machine';
import type { PaymentState } from '../../domain/payment/state-machine';
import {
  PAYOUT_DECISION_MACHINE,
  type PayoutDecisionContext,
  type PayoutDecisionEvent,
  type PayoutState,
} from '../../domain/payout/decision-machine';
import { type GovernedRequest, type GovernedSpec, executeGovernedChange } from './governed-change';
import { type HistoryEntry, auditHistory } from './history';
import { availableInterventions } from './intervention-service';
import { type AdminOutcome, isUuid, precondition } from './outcome';
import { type Page, type PageRequest, iso, minor, newestFirst, pageSize, toPage } from './pagination';

type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];
type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];
type RefundStatus = (typeof REFUND_STATUSES)[number];

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export interface AdminPaymentSummary {
  readonly paymentId: string;
  readonly status: string;
  readonly provider: string;
  readonly amountMinor: string;
  readonly refundedAmountMinor: string;
  readonly currency: string;
  readonly methodDescriptor: string | null;
  /** Whether a signature-verified webhook confirmed the capture. */
  readonly webhookConfirmed: boolean;
  readonly customer: { readonly customerId: string; readonly fullName: string };
  readonly order: {
    readonly orderId: string;
    readonly orderNumber: string;
    readonly type: string;
    readonly projectId: string | null;
    readonly contractId: string | null;
    readonly milestoneId: string | null;
  };
  readonly createdAt: string;
  readonly capturedAt: string | null;
  readonly failedAt: string | null;
  readonly failureCode: string | null;
}

const PAYMENT_SUMMARY_SELECT = {
  id: true,
  status: true,
  provider: true,
  amountMinor: true,
  refundedAmountMinor: true,
  currency: true,
  methodDescriptor: true,
  confirmedByWebhookEventId: true,
  createdAt: true,
  capturedAt: true,
  failedAt: true,
  failureCode: true,
  customer: { select: { id: true, user: { select: { fullName: true } } } },
  order: { select: { id: true, orderNumber: true, type: true, projectId: true, contractId: true, milestoneId: true } },
} as const;

interface PaymentSummaryRow {
  readonly id: string;
  readonly status: string;
  readonly provider: string;
  readonly amountMinor: bigint;
  readonly refundedAmountMinor: bigint;
  readonly currency: string;
  readonly methodDescriptor: string | null;
  readonly confirmedByWebhookEventId: string | null;
  readonly createdAt: Date;
  readonly capturedAt: Date | null;
  readonly failedAt: Date | null;
  readonly failureCode: string | null;
  readonly customer: { readonly id: string; readonly user: { readonly fullName: string } };
  readonly order: {
    readonly id: string;
    readonly orderNumber: string;
    readonly type: string;
    readonly projectId: string | null;
    readonly contractId: string | null;
    readonly milestoneId: string | null;
  };
}

function toPaymentSummary(row: PaymentSummaryRow): AdminPaymentSummary {
  return {
    paymentId: row.id,
    status: row.status,
    provider: row.provider,
    amountMinor: row.amountMinor.toString(),
    refundedAmountMinor: row.refundedAmountMinor.toString(),
    currency: row.currency,
    methodDescriptor: row.methodDescriptor,
    webhookConfirmed: row.confirmedByWebhookEventId !== null,
    customer: { customerId: row.customer.id, fullName: row.customer.user.fullName },
    order: {
      orderId: row.order.id,
      orderNumber: row.order.orderNumber,
      type: row.order.type,
      projectId: row.order.projectId,
      contractId: row.order.contractId,
      milestoneId: row.order.milestoneId,
    },
    createdAt: row.createdAt.toISOString(),
    capturedAt: iso(row.capturedAt),
    failedAt: iso(row.failedAt),
    failureCode: row.failureCode,
  };
}

export async function listPayments(
  params: PageRequest & {
    readonly actor: Actor;
    readonly status?: PaymentState | undefined;
    readonly provider?: PaymentProvider | undefined;
  },
  db: Db = prisma,
): Promise<Page<AdminPaymentSummary>> {
  assertCapability(params.actor, 'PAYMENTS_READ');
  const size = pageSize(params.limit);

  const rows = await db.payment.findMany({
    where: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.provider ? { provider: params.provider } : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: PAYMENT_SUMMARY_SELECT,
  });

  return toPage(rows, size, toPaymentSummary);
}

export interface AdminPaymentDetail extends AdminPaymentSummary {
  readonly providerPaymentId: string | null;
  readonly providerOrderId: string | null;
  readonly initiatedAt: string | null;
  readonly failureMessage: string | null;
  readonly attempts: readonly {
    readonly attemptNumber: number;
    readonly status: string;
    readonly providerReference: string | null;
    readonly errorCode: string | null;
    readonly errorMessage: string | null;
    readonly attemptedAt: string;
  }[];
  readonly confirmation: {
    readonly webhookEventId: string;
    readonly eventType: string;
    readonly signatureVerified: boolean;
    readonly receivedAt: string;
  } | null;
  readonly refunds: readonly {
    readonly refundId: string;
    readonly status: string;
    readonly amountMinor: string;
    readonly isPartial: boolean;
    readonly reason: string;
    readonly requestedAt: string;
  }[];
  readonly transactions: readonly {
    readonly transactionId: string;
    readonly transactionNumber: string;
    readonly type: string;
    readonly status: string;
    readonly amountMinor: string;
    readonly currency: string;
    readonly occurredAt: string;
    /** Present only for callers who may read the ledger. */
    readonly ledgerEntries:
      | readonly { readonly account: string; readonly entryType: string; readonly amountMinor: string }[]
      | null;
  }[];
  readonly availableInterventions: readonly string[];
}

export async function getPayment(
  params: { readonly actor: Actor; readonly paymentId: string },
  db: Db = prisma,
): Promise<AdminPaymentDetail | null> {
  assertCapability(params.actor, 'PAYMENTS_READ');
  if (!isUuid(params.paymentId)) return null;

  const canReadLedger = hasCapability(params.actor, 'LEDGER_READ');
  const payment = await db.payment.findUnique({
    where: { id: params.paymentId },
    select: {
      ...PAYMENT_SUMMARY_SELECT,
      providerPaymentId: true,
      providerOrderId: true,
      initiatedAt: true,
      failureMessage: true,
      attempts: {
        orderBy: { attemptNumber: 'asc' },
        select: {
          attemptNumber: true,
          status: true,
          providerReference: true,
          errorCode: true,
          errorMessage: true,
          attemptedAt: true,
        },
      },
      confirmedByWebhookEvent: { select: { id: true, eventType: true, signatureVerified: true, receivedAt: true } },
      refunds: {
        orderBy: { id: 'asc' },
        select: { id: true, status: true, amountMinor: true, isPartial: true, reason: true, requestedAt: true },
      },
      transactions: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          transactionNumber: true,
          type: true,
          status: true,
          amountMinor: true,
          currency: true,
          occurredAt: true,
          ledgerEntries: { select: { account: true, entryType: true, amountMinor: true } },
        },
      },
    },
  });
  if (!payment) return null;

  return {
    ...toPaymentSummary(payment),
    providerPaymentId: payment.providerPaymentId,
    providerOrderId: payment.providerOrderId,
    initiatedAt: iso(payment.initiatedAt),
    failureMessage: payment.failureMessage,
    attempts: payment.attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      providerReference: attempt.providerReference,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
      attemptedAt: attempt.attemptedAt.toISOString(),
    })),
    confirmation: payment.confirmedByWebhookEvent
      ? {
          webhookEventId: payment.confirmedByWebhookEvent.id,
          eventType: payment.confirmedByWebhookEvent.eventType,
          signatureVerified: payment.confirmedByWebhookEvent.signatureVerified,
          receivedAt: payment.confirmedByWebhookEvent.receivedAt.toISOString(),
        }
      : null,
    refunds: payment.refunds.map((refund) => ({
      refundId: refund.id,
      status: refund.status,
      amountMinor: refund.amountMinor.toString(),
      isPartial: refund.isPartial,
      reason: refund.reason,
      requestedAt: refund.requestedAt.toISOString(),
    })),
    transactions: payment.transactions.map((transaction) => ({
      transactionId: transaction.id,
      transactionNumber: transaction.transactionNumber,
      type: transaction.type,
      status: transaction.status,
      amountMinor: transaction.amountMinor.toString(),
      currency: transaction.currency,
      occurredAt: transaction.occurredAt.toISOString(),
      ledgerEntries: canReadLedger
        ? transaction.ledgerEntries.map((entry) => ({
            account: entry.account,
            entryType: entry.entryType,
            amountMinor: entry.amountMinor.toString(),
          }))
        : null,
    })),
    availableInterventions: availableInterventions('Payment', payment.status),
  };
}

// ---------------------------------------------------------------------------
// Ledger — read-only
// ---------------------------------------------------------------------------

export interface LedgerAccountBalance {
  readonly account: string;
  readonly currency: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  /** Credits minus debits. */
  readonly netCreditMinor: string;
  readonly entryCount: number;
}

export interface LedgerCurrencyTotal {
  readonly currency: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  /** Double entry: total debits equal total credits in every currency. */
  readonly balanced: boolean;
}

export interface LedgerSummary {
  readonly accounts: readonly LedgerAccountBalance[];
  readonly totals: readonly LedgerCurrencyTotal[];
  readonly transactionCount: number;
  readonly generatedAt: string;
}

export async function getLedgerSummary(
  params: { readonly actor: Actor; readonly currency?: string | undefined },
  db: Db = prisma,
): Promise<LedgerSummary> {
  assertCapability(params.actor, 'LEDGER_READ');
  const where = params.currency ? { currency: params.currency } : {};

  const [groups, transactionCount] = await Promise.all([
    db.ledgerEntry.groupBy({
      by: ['account', 'entryType', 'currency'],
      where,
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    db.transaction.count({ where }),
  ]);

  const accounts = new Map<string, { account: string; currency: string; debit: bigint; credit: bigint; entries: number }>();
  const totals = new Map<string, { debit: bigint; credit: bigint }>();

  for (const group of groups) {
    const amount = group._sum.amountMinor ?? 0n;
    const key = `${group.account}|${group.currency}`;
    const account = accounts.get(key) ?? { account: group.account, currency: group.currency, debit: 0n, credit: 0n, entries: 0 };
    const total = totals.get(group.currency) ?? { debit: 0n, credit: 0n };
    if (group.entryType === 'DEBIT') {
      account.debit += amount;
      total.debit += amount;
    } else {
      account.credit += amount;
      total.credit += amount;
    }
    account.entries += group._count._all;
    accounts.set(key, account);
    totals.set(group.currency, total);
  }

  return {
    accounts: [...accounts.values()]
      .sort((a, b) => a.currency.localeCompare(b.currency) || a.account.localeCompare(b.account))
      .map((account) => ({
        account: account.account,
        currency: account.currency,
        debitMinor: account.debit.toString(),
        creditMinor: account.credit.toString(),
        netCreditMinor: (account.credit - account.debit).toString(),
        entryCount: account.entries,
      })),
    totals: [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, total]) => ({
        currency,
        debitMinor: total.debit.toString(),
        creditMinor: total.credit.toString(),
        balanced: total.debit === total.credit,
      })),
    transactionCount,
    generatedAt: new Date().toISOString(),
  };
}

export interface AdminLedgerEntry {
  readonly entryId: string;
  readonly account: string;
  readonly entryType: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly memo: string | null;
  readonly occurredAt: string;
  readonly transaction: {
    readonly transactionId: string;
    readonly transactionNumber: string;
    readonly type: string;
    readonly status: string;
  };
}

export async function listLedgerEntries(
  params: PageRequest & {
    readonly actor: Actor;
    readonly account?: LedgerAccount | undefined;
    readonly transactionId?: string | undefined;
  },
  db: Db = prisma,
): Promise<Page<AdminLedgerEntry>> {
  assertCapability(params.actor, 'LEDGER_READ');
  const size = pageSize(params.limit);

  const rows = await db.ledgerEntry.findMany({
    where: {
      ...(params.account ? { account: params.account } : {}),
      ...(params.transactionId ? { transactionId: params.transactionId } : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: {
      id: true,
      account: true,
      entryType: true,
      amountMinor: true,
      currency: true,
      subjectType: true,
      subjectId: true,
      memo: true,
      occurredAt: true,
      transaction: { select: { id: true, transactionNumber: true, type: true, status: true } },
    },
  });

  return toPage(rows, size, (row) => ({
    entryId: row.id,
    account: row.account,
    entryType: row.entryType,
    amountMinor: row.amountMinor.toString(),
    currency: row.currency,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    memo: row.memo,
    occurredAt: row.occurredAt.toISOString(),
    transaction: {
      transactionId: row.transaction.id,
      transactionNumber: row.transaction.transactionNumber,
      type: row.transaction.type,
      status: row.transaction.status,
    },
  }));
}

// ---------------------------------------------------------------------------
// Refunds — read-only
// ---------------------------------------------------------------------------

export interface AdminRefund {
  readonly refundId: string;
  readonly status: string;
  readonly provider: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly isPartial: boolean;
  readonly reason: string;
  readonly paymentId: string;
  readonly milestoneId: string | null;
  readonly requestedBy: string | null;
  readonly approvedBy: string | null;
  readonly requestedAt: string;
  readonly approvedAt: string | null;
  readonly processedAt: string | null;
  readonly failureCode: string | null;
}

export async function listRefunds(
  params: PageRequest & { readonly actor: Actor; readonly status?: RefundStatus | undefined },
  db: Db = prisma,
): Promise<Page<AdminRefund>> {
  assertCapability(params.actor, 'REFUNDS_READ');
  const size = pageSize(params.limit);

  const rows = await db.refund.findMany({
    where: { ...(params.status ? { status: params.status } : {}), ...newestFirst(params.cursor) },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: {
      id: true,
      status: true,
      provider: true,
      amountMinor: true,
      currency: true,
      isPartial: true,
      reason: true,
      paymentId: true,
      milestoneId: true,
      requestedAt: true,
      approvedAt: true,
      processedAt: true,
      failureCode: true,
      requestedBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
    },
  });

  return toPage(rows, size, (row) => ({
    refundId: row.id,
    status: row.status,
    provider: row.provider,
    amountMinor: row.amountMinor.toString(),
    currency: row.currency,
    isPartial: row.isPartial,
    reason: row.reason,
    paymentId: row.paymentId,
    milestoneId: row.milestoneId,
    requestedBy: row.requestedBy?.fullName ?? null,
    approvedBy: row.approvedBy?.fullName ?? null,
    requestedAt: row.requestedAt.toISOString(),
    approvedAt: iso(row.approvedAt),
    processedAt: iso(row.processedAt),
    failureCode: row.failureCode,
  }));
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

export type PayoutReadinessProblem =
  | 'NO_ITEMS'
  | 'CURRENCY_MISMATCH'
  | 'ITEMS_DO_NOT_RECONCILE'
  | 'EXPERT_NOT_ACTIVE'
  | 'OPEN_DISPUTE';

const READINESS_MESSAGES: Readonly<Record<PayoutReadinessProblem, string>> = {
  NO_ITEMS: 'it settles no milestones or commissions.',
  CURRENCY_MISMATCH: 'an item is in a different currency from the payout.',
  ITEMS_DO_NOT_RECONCILE: 'its items do not add up to its gross amount.',
  EXPERT_NOT_ACTIVE: 'the expert’s account is not active.',
  OPEN_DISPUTE: 'a dispute is open on a project it pays for.',
};

interface PayoutForReadiness {
  readonly grossAmountMinor: bigint;
  readonly currency: string;
  readonly expert: { readonly user: { readonly status: string } };
  readonly items: readonly {
    readonly amountMinor: bigint;
    readonly currency: string;
    readonly milestoneId: string | null;
    readonly contractId: string | null;
  }[];
}

/**
 * What stops a payout being approved. Used both to refuse an approval and to
 * show finance, before they try, why a payout is not ready.
 */
export async function payoutReadiness(db: Db, payout: PayoutForReadiness): Promise<PayoutReadinessProblem[]> {
  const problems: PayoutReadinessProblem[] = [];

  if (payout.items.length === 0) problems.push('NO_ITEMS');
  if (payout.items.some((item) => item.currency !== payout.currency)) problems.push('CURRENCY_MISMATCH');
  const itemTotal = payout.items.reduce((sum, item) => sum + item.amountMinor, 0n);
  if (payout.items.length > 0 && itemTotal !== payout.grossAmountMinor) problems.push('ITEMS_DO_NOT_RECONCILE');
  if (payout.expert.user.status !== 'ACTIVE') problems.push('EXPERT_NOT_ACTIVE');

  // The same rule as escrow RELEASE: no money leaves while a dispute on the work is open.
  const milestoneIds = payout.items.flatMap((item) => (item.milestoneId ? [item.milestoneId] : []));
  const contractIds = payout.items.flatMap((item) => (item.contractId ? [item.contractId] : []));
  const [milestones, contracts] = await Promise.all([
    milestoneIds.length > 0
      ? db.milestone.findMany({ where: { id: { in: milestoneIds } }, select: { projectId: true } })
      : Promise.resolve([]),
    contractIds.length > 0
      ? db.contract.findMany({ where: { id: { in: contractIds } }, select: { projectId: true } })
      : Promise.resolve([]),
  ]);
  const projectIds = [...new Set([...milestones, ...contracts].map((row) => row.projectId))];
  if (projectIds.length > 0) {
    const openDisputes = await db.dispute.count({
      where: { projectId: { in: projectIds }, status: { in: [...DISPUTE_OPEN_STATES] } },
    });
    if (openDisputes > 0) problems.push('OPEN_DISPUTE');
  }

  return problems;
}

export interface AdminPayoutSummary {
  readonly payoutId: string;
  readonly payoutNumber: string;
  readonly status: string;
  readonly provider: string;
  readonly method: string;
  readonly grossAmountMinor: string;
  readonly commissionAmountMinor: string;
  readonly netAmountMinor: string;
  readonly currency: string;
  readonly expert: { readonly expertId: string; readonly userId: string; readonly fullName: string };
  readonly itemCount: number;
  readonly scheduledFor: string | null;
  readonly approvedAt: string | null;
  readonly processedAt: string | null;
  readonly holdReason: string | null;
  readonly createdAt: string;
}

const PAYOUT_SUMMARY_SELECT = {
  id: true,
  payoutNumber: true,
  status: true,
  provider: true,
  method: true,
  grossAmountMinor: true,
  commissionAmountMinor: true,
  netAmountMinor: true,
  currency: true,
  scheduledFor: true,
  approvedAt: true,
  processedAt: true,
  holdReason: true,
  createdAt: true,
  expert: { select: { id: true, userId: true, user: { select: { fullName: true, status: true } } } },
  _count: { select: { items: true } },
} as const;

interface PayoutSummaryRow {
  readonly id: string;
  readonly payoutNumber: string;
  readonly status: string;
  readonly provider: string;
  readonly method: string;
  readonly grossAmountMinor: bigint;
  readonly commissionAmountMinor: bigint;
  readonly netAmountMinor: bigint;
  readonly currency: string;
  readonly scheduledFor: Date | null;
  readonly approvedAt: Date | null;
  readonly processedAt: Date | null;
  readonly holdReason: string | null;
  readonly createdAt: Date;
  readonly expert: { readonly id: string; readonly userId: string; readonly user: { readonly fullName: string } };
  readonly _count: { readonly items: number };
}

function toPayoutSummary(row: PayoutSummaryRow): AdminPayoutSummary {
  return {
    payoutId: row.id,
    payoutNumber: row.payoutNumber,
    status: row.status,
    provider: row.provider,
    method: row.method,
    grossAmountMinor: row.grossAmountMinor.toString(),
    commissionAmountMinor: row.commissionAmountMinor.toString(),
    netAmountMinor: row.netAmountMinor.toString(),
    currency: row.currency,
    expert: { expertId: row.expert.id, userId: row.expert.userId, fullName: row.expert.user.fullName },
    itemCount: row._count.items,
    scheduledFor: iso(row.scheduledFor),
    approvedAt: iso(row.approvedAt),
    processedAt: iso(row.processedAt),
    holdReason: row.holdReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPayouts(
  params: PageRequest & {
    readonly actor: Actor;
    readonly status?: PayoutState | undefined;
    readonly expertId?: string | undefined;
  },
  db: Db = prisma,
): Promise<Page<AdminPayoutSummary>> {
  assertCapability(params.actor, 'PAYOUTS_READ');
  const size = pageSize(params.limit);

  const rows = await db.payout.findMany({
    where: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.expertId ? { expertId: params.expertId } : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: PAYOUT_SUMMARY_SELECT,
  });

  return toPage(rows, size, toPayoutSummary);
}

export interface AdminPayoutDetail extends AdminPayoutSummary {
  readonly items: readonly {
    readonly amountMinor: string;
    readonly currency: string;
    readonly description: string | null;
    readonly milestoneId: string | null;
    readonly contractId: string | null;
    readonly commissionId: string | null;
  }[];
  readonly approvedBy: { readonly userId: string; readonly fullName: string } | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  /** Why the payout could not be approved now; empty when it could. */
  readonly readiness: readonly { readonly problem: PayoutReadinessProblem; readonly message: string }[];
  readonly availableDecisions: readonly PayoutDecisionEvent[];
  readonly history: readonly HistoryEntry[];
}

export async function getPayout(
  params: { readonly actor: Actor; readonly payoutId: string },
  db: Db = prisma,
): Promise<AdminPayoutDetail | null> {
  assertCapability(params.actor, 'PAYOUTS_READ');
  if (!isUuid(params.payoutId)) return null;

  const payout = await db.payout.findUnique({
    where: { id: params.payoutId },
    select: {
      ...PAYOUT_SUMMARY_SELECT,
      failureCode: true,
      failureMessage: true,
      approvedBy: { select: { id: true, fullName: true } },
      items: {
        orderBy: { id: 'asc' },
        select: {
          amountMinor: true,
          currency: true,
          description: true,
          milestoneId: true,
          contractId: true,
          commissionId: true,
        },
      },
    },
  });
  if (!payout) return null;

  const problems = await payoutReadiness(db, payout);

  return {
    ...toPayoutSummary(payout),
    items: payout.items.map((item) => ({
      amountMinor: item.amountMinor.toString(),
      currency: item.currency,
      description: item.description,
      milestoneId: item.milestoneId,
      contractId: item.contractId,
      commissionId: item.commissionId,
    })),
    approvedBy: payout.approvedBy ? { userId: payout.approvedBy.id, fullName: payout.approvedBy.fullName } : null,
    failureCode: payout.failureCode,
    failureMessage: payout.failureMessage,
    readiness: problems.map((problem) => ({ problem, message: READINESS_MESSAGES[problem] })),
    availableDecisions: availableEvents(PAYOUT_DECISION_MACHINE, payout.status, 'HUMAN', {}),
    history: await auditHistory(db, 'Payout', payout.id, [AUDIT_ACTIONS.ADMIN_PAYOUT_TRANSITIONED]),
  };
}

interface PayoutRow extends PayoutForReadiness {
  readonly id: string;
  readonly payoutNumber: string;
  readonly status: PayoutState;
  readonly netAmountMinor: bigint;
  readonly expert: { readonly userId: string; readonly user: { readonly status: string } };
}

const PAYOUT_SPEC: GovernedSpec<PayoutState, PayoutDecisionEvent, PayoutDecisionContext, PayoutRow, null> = {
  entityType: 'Payout',
  table: 'payouts',
  machine: PAYOUT_DECISION_MACHINE,
  auditAction: AUDIT_ACTIONS.ADMIN_PAYOUT_TRANSITIONED,

  load: (tx, id) =>
    tx.payout.findUnique({
      where: { id },
      select: {
        id: true,
        payoutNumber: true,
        status: true,
        grossAmountMinor: true,
        netAmountMinor: true,
        currency: true,
        expert: { select: { userId: true, user: { select: { status: true } } } },
        items: { select: { amountMinor: true, currency: true, milestoneId: true, contractId: true } },
      },
    }),

  status: (row) => row.status,

  context: () => ({}),

  // Nobody decides their own payout.
  guard: async (_tx, row, _event, actor) => checkNotParty(actor, [row.expert.userId]),

  async prepare({ tx, entity, event }) {
    if (event === 'APPROVE') {
      const problems = await payoutReadiness(tx, entity);
      if (problems.length > 0) {
        throw precondition(`This payout cannot be approved: ${problems.map((problem) => READINESS_MESSAGES[problem]).join(' ')}`);
      }
    }
    return null;
  },

  async write({ tx, entity, event, from, to, request, reason, now }) {
    const decision =
      event === 'APPROVE'
        ? { approvedByUserId: request.actor.userId, approvedAt: now }
        : event === 'HOLD'
          ? { holdReason: reason }
          : event === 'RELEASE_HOLD'
            ? // A payout that was stopped must be approved again.
              { holdReason: null, approvedByUserId: null, approvedAt: null }
            : {};
    const result = await tx.payout.updateMany({ where: { id: entity.id, status: from }, data: { status: to, ...decision } });
    return result.count;
  },

  effects: async ({ entity }) => ({
    payoutNumber: entity.payoutNumber,
    netAmountMinor: minor(entity.netAmountMinor),
    currency: entity.currency,
  }),
};

/** Approve, hold, release a hold on, or cancel a payout. None of these moves money. */
export function transitionPayout(request: GovernedRequest, db: Db = prisma): Promise<AdminOutcome> {
  return executeGovernedChange(PAYOUT_SPEC, request, db);
}

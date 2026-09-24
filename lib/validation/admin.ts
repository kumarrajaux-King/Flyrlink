/**
 * Zod schemas for the admin control-plane API.
 *
 * `strictObject` throughout, so a client cannot smuggle in anything the server
 * decides: not an actor, not an approver, not a status to write, not an award,
 * not a ledger amount. Query strings are validated the same way — an unknown
 * parameter is a 422, not silently ignored.
 *
 * The justification policy (reason length, confirmation) is enforced in the
 * services rather than here, so a missing justification on a high-risk action
 * is refused and audited instead of disappearing as a validation error.
 */

import { z } from 'zod';

import { ACCOUNT_EVENTS, ACCOUNT_STATES } from '../../domain/account/state-machine';
import { CONTRACT_EVENTS, CONTRACT_STATES } from '../../domain/contract/state-machine';
import { DISPUTE_STATES, DISPUTE_TRIAGE_EVENTS } from '../../domain/dispute/triage-machine';
import { MILESTONE_EVENTS, MILESTONE_STATES } from '../../domain/milestone/state-machine';
import { PAYMENT_EVENTS, PAYMENT_STATES } from '../../domain/payment/state-machine';
import { PAYOUT_DECISION_EVENTS, PAYOUT_STATES } from '../../domain/payout/decision-machine';
import { PROJECT_EVENTS, PROJECT_STATES } from '../../domain/project/state-machine';
import { REVIEW_MODERATION_EVENTS, REVIEW_STATES } from '../../domain/review/moderation-machine';
import {
  VERIFICATION_EVENTS,
  VERIFICATION_STAGES,
  VERIFICATION_STATES,
} from '../../domain/verification/state-machine';
import { REASON_MAX_LENGTH } from '../authz/admin-policy';
import { ROLE_NAMES } from '../authz/roles';
import { AGENT_KEYS } from './ai';

export const MAX_PAGE_SIZE = 100;

export const PROJECT_SOURCES = ['DIRECT_HIRE', 'POSTED_PROJECT', 'PREDEFINED_SERVICE'] as const;
export const RISK_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const PAYMENT_PROVIDERS = ['RAZORPAY', 'STRIPE', 'CASHFREE', 'MANUAL'] as const;
export const LEDGER_ACCOUNTS = [
  'CUSTOMER_ESCROW',
  'PLATFORM_COMMISSION',
  'EXPERT_PAYABLE',
  'GATEWAY_FEE',
  'TAX_PAYABLE',
  'REFUND_LIABILITY',
  'PLATFORM_CASH',
] as const;
export const REFUND_STATUSES = [
  'REQUESTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;
export const AI_ACTION_STATUSES = [
  'PROPOSED',
  'AUTO_APPROVED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'FAILED',
  'EXPIRED',
] as const;
export const AI_RISK_TIERS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const RECOMMENDATION_STATUSES = ['PROPOSED', 'PRESENTED', 'ACCEPTED', 'DECLINED', 'SUPERSEDED', 'EXPIRED'] as const;
export const AUDIT_SEVERITIES = ['INFO', 'NOTICE', 'WARNING', 'CRITICAL'] as const;
export const DISPUTE_RESOLUTIONS = ['RESOLVED_CUSTOMER', 'RESOLVED_EXPERT', 'RESOLVED_SPLIT', 'WITHDRAWN'] as const;

const booleanFlag = z.enum(['true', 'false']);

const page = {
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
};

const search = z.string().trim().min(2).max(120).optional();

/** Length and type only; the minimum is policy, enforced and audited by the service. */
const reason = z.string().max(REASON_MAX_LENGTH).optional();

const justification = {
  reason,
  confirm: z.boolean().optional(),
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const emptyQuerySchema = z.strictObject({});

export const userListQuerySchema = z.strictObject({
  q: search,
  status: z.enum(ACCOUNT_STATES).optional(),
  role: z.enum(ROLE_NAMES).optional(),
  ...page,
});

export const customerListQuerySchema = z.strictObject({
  q: search,
  status: z.enum(ACCOUNT_STATES).optional(),
  ...page,
});

export const expertListQuerySchema = z.strictObject({
  q: search,
  verificationStatus: z.enum(VERIFICATION_STATES).optional(),
  ...page,
});

export const verificationQueueQuerySchema = z.strictObject({
  stage: z.enum(VERIFICATION_STAGES).optional(),
  ...page,
});

export const projectListQuerySchema = z.strictObject({
  status: z.enum(PROJECT_STATES).optional(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  source: z.enum(PROJECT_SOURCES).optional(),
  customerId: z.uuid().optional(),
  ...page,
});

export const contractListQuerySchema = z.strictObject({
  status: z.enum(CONTRACT_STATES).optional(),
  projectId: z.uuid().optional(),
  ...page,
});

export const milestoneListQuerySchema = z.strictObject({
  status: z.enum(MILESTONE_STATES).optional(),
  projectId: z.uuid().optional(),
  contractId: z.uuid().optional(),
  ...page,
});

export const paymentListQuerySchema = z.strictObject({
  status: z.enum(PAYMENT_STATES).optional(),
  provider: z.enum(PAYMENT_PROVIDERS).optional(),
  ...page,
});

export const ledgerSummaryQuerySchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
});

export const ledgerEntryQuerySchema = z.strictObject({
  account: z.enum(LEDGER_ACCOUNTS).optional(),
  transactionId: z.uuid().optional(),
  ...page,
});

export const refundListQuerySchema = z.strictObject({
  status: z.enum(REFUND_STATUSES).optional(),
  ...page,
});

export const payoutListQuerySchema = z.strictObject({
  status: z.enum(PAYOUT_STATES).optional(),
  expertId: z.uuid().optional(),
  ...page,
});

export const disputeListQuerySchema = z.strictObject({
  status: z.enum(DISPUTE_STATES).optional(),
  projectId: z.uuid().optional(),
  ...page,
});

export const reviewListQuerySchema = z.strictObject({
  status: z.enum(REVIEW_STATES).optional(),
  revieweeUserId: z.uuid().optional(),
  ...page,
});

export const categoryTreeQuerySchema = z.strictObject({
  includeInactive: booleanFlag.optional(),
});

export const aiActionListQuerySchema = z.strictObject({
  status: z.enum(AI_ACTION_STATUSES).optional(),
  riskTier: z.enum(AI_RISK_TIERS).optional(),
  toolName: z.string().min(1).max(80).optional(),
  failedOnly: booleanFlag.optional(),
  ...page,
});

export const aiRecommendationListQuerySchema = z.strictObject({
  status: z.enum(RECOMMENDATION_STATUSES).optional(),
  projectId: z.uuid().optional(),
  ...page,
});

export const aiOverviewQuerySchema = z.strictObject({
  sinceHours: z.coerce.number().int().min(1).max(24 * 90).optional(),
});

export const supportLookupQuerySchema = z.strictObject({
  q: z.string().trim().min(2).max(200),
});

export const auditLogQuerySchema = z.strictObject({
  action: z.string().min(1).max(100).optional(),
  entityType: z.string().min(1).max(60).optional(),
  entityId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
  severity: z.enum(AUDIT_SEVERITIES).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  ...page,
});

// ---------------------------------------------------------------------------
// Governed state changes
// ---------------------------------------------------------------------------

export const accountTransitionSchema = z.strictObject({
  event: z.enum(ACCOUNT_EVENTS),
  expectedStatus: z.enum(ACCOUNT_STATES).optional(),
  ...justification,
});

export const verificationTransitionSchema = z.strictObject({
  event: z.enum(VERIFICATION_EVENTS),
  expectedStatus: z.enum(VERIFICATION_STATES).optional(),
  ...justification,
  params: z.strictObject({ acknowledgeAiFlags: z.boolean().optional() }).optional(),
});

export const disputeTriageSchema = z.strictObject({
  event: z.enum(DISPUTE_TRIAGE_EVENTS),
  expectedStatus: z.enum(DISPUTE_STATES).optional(),
  ...justification,
});

export const reviewModerationSchema = z.strictObject({
  event: z.enum(REVIEW_MODERATION_EVENTS),
  expectedStatus: z.enum(REVIEW_STATES).optional(),
  ...justification,
});

export const payoutDecisionSchema = z.strictObject({
  event: z.enum(PAYOUT_DECISION_EVENTS),
  expectedStatus: z.enum(PAYOUT_STATES).optional(),
  ...justification,
});

// ---------------------------------------------------------------------------
// Lifecycle interventions
// ---------------------------------------------------------------------------

/**
 * What an intervention may pass to the lifecycle. Deliberately absent: webhook
 * event ids, refunded amounts and failure codes — provider truth that only the
 * server's webhook handling may supply.
 */
const interventionParams = z.strictObject({
  notes: z.string().trim().min(1).max(5000).optional(),
  resolution: z.enum(DISPUTE_RESOLUTIONS).optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  assignmentId: z.uuid().optional(),
});

export const projectInterventionSchema = z.strictObject({
  event: z.enum(PROJECT_EVENTS),
  expectedStatus: z.enum(PROJECT_STATES).optional(),
  ...justification,
  params: interventionParams.optional(),
});

export const contractInterventionSchema = z.strictObject({
  event: z.enum(CONTRACT_EVENTS),
  expectedStatus: z.enum(CONTRACT_STATES).optional(),
  ...justification,
  params: interventionParams.optional(),
});

export const milestoneInterventionSchema = z.strictObject({
  event: z.enum(MILESTONE_EVENTS),
  expectedStatus: z.enum(MILESTONE_STATES).optional(),
  ...justification,
  params: interventionParams.optional(),
});

export const paymentInterventionSchema = z.strictObject({
  event: z.enum(PAYMENT_EVENTS),
  expectedStatus: z.enum(PAYMENT_STATES).optional(),
  ...justification,
  params: interventionParams.optional(),
});

/**
 * A dispute decision. `notes` is both the lifecycle's resolution notes and the
 * justification. There are no award amounts: awards move money, and that waits
 * for the Phase 10 ledger.
 */
export const disputeResolutionSchema = z.strictObject({
  resolution: z.enum(DISPUTE_RESOLUTIONS),
  notes: z.string().max(5000),
  closeProject: z.boolean().optional(),
  expectedStatus: z.enum(DISPUTE_STATES).optional(),
  confirm: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Other mutations
// ---------------------------------------------------------------------------

export const reasonOnlySchema = z.strictObject({ reason });

const categorySlug = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single hyphens.');

export const createCategorySchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  slug: categorySlug,
  description: z.string().trim().max(2000).optional(),
  parentId: z.uuid().nullable().optional(),
  orderIndex: z.number().int().min(0).max(100_000).optional(),
  reason,
});

export const updateCategorySchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    parentId: z.uuid().nullable().optional(),
    orderIndex: z.number().int().min(0).max(100_000).optional(),
    reason,
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.parentId !== undefined ||
      value.orderIndex !== undefined,
    { message: 'Change at least one of name, description, parentId or orderIndex.', path: ['_'] },
  );

export const categoryStatusSchema = z.strictObject({
  isActive: z.boolean(),
  ...justification,
});

export const agentStatusSchema = z.strictObject({
  enabled: z.boolean(),
  ...justification,
});

export const agentKeyParamSchema = z.enum(AGENT_KEYS);

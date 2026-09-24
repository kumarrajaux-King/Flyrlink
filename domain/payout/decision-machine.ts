/**
 * Payout decisions — the human finance controls on `Payout.status` (Phase 8).
 *
 *   PENDING_APPROVAL → APPROVED
 *   PENDING | PENDING_APPROVAL | APPROVED → ON_HOLD → PENDING_APPROVAL
 *   PENDING | PENDING_APPROVAL | APPROVED | ON_HOLD → CANCELLED
 *
 * None of these events moves money. Approval authorises a payout that the
 * provider integration (Phase 10) will later process; PROCESSING, PAID and
 * FAILED are provider-attested states that no event here can produce, the same
 * way only a verified webhook can mark a payment SUCCEEDED.
 *
 * Every event is human-only, financial, and needs `payout:approve:any`
 * (FINANCE and SUPER_ADMIN, both MFA-gated). Releasing a hold returns the payout
 * to PENDING_APPROVAL rather than to APPROVED: a payout that was stopped must be
 * approved again.
 */

import type { StateMachine, TransitionDefinition } from '../lifecycle/machine';

export const PAYOUT_STATES = [
  'PENDING',
  'PENDING_APPROVAL',
  'APPROVED',
  'PROCESSING',
  'PAID',
  'FAILED',
  'CANCELLED',
  'ON_HOLD',
] as const;

export type PayoutState = (typeof PAYOUT_STATES)[number];

/** States only the payout provider can attest to. No administrative event reaches them. */
export const PAYOUT_PROVIDER_STATES: readonly PayoutState[] = ['PROCESSING', 'PAID', 'FAILED'];

export const PAYOUT_DECISION_EVENTS = ['APPROVE', 'HOLD', 'RELEASE_HOLD', 'CANCEL'] as const;

export type PayoutDecisionEvent = (typeof PAYOUT_DECISION_EVENTS)[number];

export type PayoutDecisionContext = Record<string, never>;

const APPROVE_PAYOUTS = ['payout:approve:any'] as const;

type Def = TransitionDefinition<PayoutState, PayoutDecisionEvent, PayoutDecisionContext>;

const transitions: readonly Def[] = [
  {
    event: 'APPROVE',
    from: ['PENDING_APPROVAL'],
    to: 'APPROVED',
    actors: ['HUMAN'],
    permissions: APPROVE_PAYOUTS,
    risk: 'CRITICAL',
    financial: true,
    description: 'Finance approves the payout for provider processing.',
  },
  {
    event: 'HOLD',
    from: ['PENDING', 'PENDING_APPROVAL', 'APPROVED'],
    to: 'ON_HOLD',
    actors: ['HUMAN'],
    permissions: APPROVE_PAYOUTS,
    risk: 'HIGH',
    financial: true,
    description: 'Finance stops the payout before processing.',
  },
  {
    event: 'RELEASE_HOLD',
    from: ['ON_HOLD'],
    to: 'PENDING_APPROVAL',
    actors: ['HUMAN'],
    permissions: APPROVE_PAYOUTS,
    risk: 'HIGH',
    financial: true,
    description: 'The hold is lifted; the payout needs approval again.',
  },
  {
    event: 'CANCEL',
    from: ['PENDING', 'PENDING_APPROVAL', 'APPROVED', 'ON_HOLD'],
    to: 'CANCELLED',
    actors: ['HUMAN'],
    permissions: APPROVE_PAYOUTS,
    risk: 'HIGH',
    financial: true,
    description: 'Finance cancels the payout before processing.',
  },
];

export const PAYOUT_DECISION_MACHINE: StateMachine<PayoutState, PayoutDecisionEvent, PayoutDecisionContext> = {
  name: 'PayoutDecision',
  states: PAYOUT_STATES,
  initial: 'PENDING',
  terminal: ['PAID', 'CANCELLED'],
  transitions,
};

/**
 * Payment lifecycle — STEP 02 §10.4.
 *
 *   CREATED → PAYMENT_INITIATED → PENDING → SUCCEEDED → FUNDS_ALLOCATED
 *     → RELEASE_PENDING → RELEASED
 *   branches: FAILED · CANCELLED · REFUND_REQUESTED · REFUNDED
 *             PARTIALLY_REFUNDED · CHARGEBACK
 *
 * The rule this machine exists to enforce (blueprint rule 3):
 *
 *   **Only a verified webhook may advance a payment to SUCCEEDED.**
 *
 * CONFIRM_SUCCEEDED lists WEBHOOK as its only actor. No human, no admin, no
 * system call and no AI can fire it, and the service additionally requires the
 * referenced webhook event to be signature-verified and unused. The same applies
 * to refund confirmation and chargebacks — money state that only the provider
 * can attest to is only ever set from the provider's attestation.
 *
 * Every event here is `financial`, so none can ever be fired by an AI agent.
 */

import type { StateMachine, TransitionDefinition } from '../lifecycle/machine';

export const PAYMENT_STATES = [
  'CREATED',
  'PAYMENT_INITIATED',
  'PENDING',
  'SUCCEEDED',
  'FUNDS_ALLOCATED',
  'RELEASE_PENDING',
  'RELEASED',
  'FAILED',
  'CANCELLED',
  'REFUND_REQUESTED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CHARGEBACK',
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

export const PAYMENT_EVENTS = [
  'INITIATE',
  'MARK_PENDING',
  'CONFIRM_SUCCEEDED',
  'MARK_FAILED',
  'CANCEL',
  'ALLOCATE_FUNDS',
  'REQUEST_RELEASE',
  'RELEASE',
  'REQUEST_REFUND',
  'REJECT_REFUND',
  'CONFIRM_REFUNDED',
  'CONFIRM_PARTIAL_REFUND',
  'RECORD_CHARGEBACK',
] as const;

export type PaymentEvent = (typeof PAYMENT_EVENTS)[number];

export type PaymentContext = Record<string, never>;

/** Events whose truth only the provider can attest to. */
export const WEBHOOK_ONLY_PAYMENT_EVENTS: readonly PaymentEvent[] = [
  'CONFIRM_SUCCEEDED',
  'CONFIRM_REFUNDED',
  'CONFIRM_PARTIAL_REFUND',
  'RECORD_CHARGEBACK',
];

type Def = TransitionDefinition<PaymentState, PaymentEvent, PaymentContext>;

const transitions: readonly Def[] = [
  {
    event: 'INITIATE',
    from: ['CREATED'],
    to: 'PAYMENT_INITIATED',
    actors: ['HUMAN', 'SYSTEM'],
    permissions: ['payment:create:own'],
    party: 'CUSTOMER',
    risk: 'MEDIUM',
    financial: true,
    description: 'Customer starts checkout with the gateway.',
  },
  {
    event: 'MARK_PENDING',
    from: ['PAYMENT_INITIATED'],
    to: 'PENDING',
    actors: ['WEBHOOK', 'SYSTEM'],
    risk: 'LOW',
    financial: true,
    description: 'The gateway acknowledged the payment.',
  },
  {
    event: 'CONFIRM_SUCCEEDED',
    from: ['PAYMENT_INITIATED', 'PENDING'],
    to: 'SUCCEEDED',
    actors: ['WEBHOOK'],
    risk: 'HIGH',
    financial: true,
    description: 'A signature-verified webhook confirms capture. The ONLY route to SUCCEEDED.',
  },
  {
    event: 'MARK_FAILED',
    from: ['PAYMENT_INITIATED', 'PENDING'],
    to: 'FAILED',
    actors: ['WEBHOOK', 'SYSTEM'],
    risk: 'LOW',
    financial: true,
    description: 'The gateway reported failure.',
  },
  {
    event: 'CANCEL',
    from: ['CREATED', 'PAYMENT_INITIATED', 'PENDING'],
    to: 'CANCELLED',
    actors: ['HUMAN', 'SYSTEM'],
    permissions: ['payment:create:own'],
    party: 'CUSTOMER',
    risk: 'LOW',
    financial: true,
    description: 'Customer abandons checkout before capture.',
  },
  {
    event: 'ALLOCATE_FUNDS',
    from: ['SUCCEEDED'],
    to: 'FUNDS_ALLOCATED',
    actors: ['SYSTEM'],
    risk: 'MEDIUM',
    financial: true,
    description: 'Captured funds are allocated to escrow. Ledger posting is Phase 10.',
  },
  {
    event: 'REQUEST_RELEASE',
    from: ['FUNDS_ALLOCATED'],
    to: 'RELEASE_PENDING',
    actors: ['SYSTEM'],
    risk: 'MEDIUM',
    financial: true,
    description: 'The funded milestone was approved; escrow awaits finance release.',
  },
  {
    event: 'RELEASE',
    from: ['RELEASE_PENDING'],
    to: 'RELEASED',
    actors: ['HUMAN'],
    permissions: ['payout:approve:any'],
    risk: 'CRITICAL',
    financial: true,
    description: 'Finance releases escrow to the expert. Human, finance-only, MFA-gated.',
  },
  {
    event: 'REQUEST_REFUND',
    from: ['FUNDS_ALLOCATED'],
    to: 'REFUND_REQUESTED',
    actors: ['HUMAN'],
    permissions: ['refund:request:own', 'refund:approve:any'],
    party: 'CUSTOMER',
    risk: 'MEDIUM',
    financial: true,
    description: 'A refund is requested. Approval and processing are separate.',
  },
  {
    event: 'REJECT_REFUND',
    from: ['REFUND_REQUESTED'],
    to: 'FUNDS_ALLOCATED',
    actors: ['HUMAN'],
    permissions: ['refund:approve:any'],
    risk: 'HIGH',
    financial: true,
    description: 'Finance rejects the refund; funds return to escrow.',
  },
  {
    event: 'CONFIRM_REFUNDED',
    from: ['REFUND_REQUESTED', 'PARTIALLY_REFUNDED'],
    to: 'REFUNDED',
    actors: ['WEBHOOK'],
    risk: 'HIGH',
    financial: true,
    description: 'A verified webhook confirms the full refund.',
  },
  {
    event: 'CONFIRM_PARTIAL_REFUND',
    from: ['REFUND_REQUESTED'],
    to: 'PARTIALLY_REFUNDED',
    actors: ['WEBHOOK'],
    risk: 'HIGH',
    financial: true,
    description: 'A verified webhook confirms a partial refund.',
  },
  {
    event: 'RECORD_CHARGEBACK',
    from: ['SUCCEEDED', 'FUNDS_ALLOCATED', 'RELEASE_PENDING', 'RELEASED', 'PARTIALLY_REFUNDED'],
    to: 'CHARGEBACK',
    actors: ['WEBHOOK'],
    risk: 'CRITICAL',
    financial: true,
    description: 'A verified webhook reports a chargeback.',
  },
];

export const PAYMENT_MACHINE: StateMachine<PaymentState, PaymentEvent, PaymentContext> = {
  name: 'Payment',
  states: PAYMENT_STATES,
  initial: 'CREATED',
  terminal: ['FAILED', 'CANCELLED', 'REFUNDED', 'CHARGEBACK'],
  transitions,
};

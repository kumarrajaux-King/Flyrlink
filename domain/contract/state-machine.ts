/**
 * Contract lifecycle — STEP 02 §10.2.
 *
 *   DRAFT → SENT ⇄ NEGOTIATION → ACCEPTED → FUNDED → ACTIVE → COMPLETED → CLOSED
 *   branches: DECLINED · CANCELLED · DISPUTED · TERMINATED
 *
 * Signed terms are immutable (master spec §14): there is no transition from
 * ACCEPTED or beyond back to DRAFT, SENT or NEGOTIATION. Accepting signs the
 * current version inside the same transaction.
 *
 * The acceptor must be the expert — a customer cannot accept their own offer —
 * which is what `party: 'EXPERT'` enforces.
 */

import type { StateMachine, TransitionDefinition } from '../lifecycle/machine';

export const CONTRACT_STATES = [
  'DRAFT',
  'SENT',
  'NEGOTIATION',
  'ACCEPTED',
  'FUNDED',
  'ACTIVE',
  'COMPLETED',
  'CLOSED',
  'DECLINED',
  'CANCELLED',
  'DISPUTED',
  'TERMINATED',
] as const;

export type ContractState = (typeof CONTRACT_STATES)[number];

export type ContractEvent =
  | 'SEND'
  | 'REQUEST_CHANGES'
  | 'RESEND'
  | 'ACCEPT'
  | 'DECLINE'
  | 'CANCEL'
  | 'MARK_FUNDED'
  | 'START'
  | 'COMPLETE'
  | 'CLOSE'
  | 'RAISE_DISPUTE'
  | 'RESOLVE_DISPUTE_CONTINUE'
  | 'TERMINATE';

export type ContractContext = Record<string, never>;

const CUSTOMER_OWNS = ['contract:create:own', 'project:update:any'] as const;

type Def = TransitionDefinition<ContractState, ContractEvent, ContractContext>;

const transitions: readonly Def[] = [
  {
    event: 'SEND',
    from: ['DRAFT'],
    to: 'SENT',
    actors: ['HUMAN'],
    permissions: CUSTOMER_OWNS,
    party: 'CUSTOMER',
    risk: 'MEDIUM',
    financial: false,
    description: 'Customer sends the drafted contract to the expert.',
  },
  {
    event: 'REQUEST_CHANGES',
    from: ['SENT'],
    to: 'NEGOTIATION',
    actors: ['HUMAN'],
    permissions: ['contract:accept:own'],
    risk: 'LOW',
    financial: false,
    description: 'Either party asks for changes before acceptance.',
  },
  {
    event: 'RESEND',
    from: ['NEGOTIATION'],
    to: 'SENT',
    actors: ['HUMAN'],
    permissions: CUSTOMER_OWNS,
    party: 'CUSTOMER',
    risk: 'MEDIUM',
    financial: false,
    description: 'Customer sends a revised version.',
  },
  {
    event: 'ACCEPT',
    // STEP 02 §10.2 runs SENT → NEGOTIATION → ACCEPTED, so acceptance is valid
    // from either. The current (unsuperseded) version is what gets signed.
    from: ['SENT', 'NEGOTIATION'],
    to: 'ACCEPTED',
    actors: ['HUMAN'],
    permissions: ['contract:accept:own'],
    party: 'EXPERT',
    risk: 'HIGH',
    financial: false,
    description: 'Expert accepts and signs the current version. Terms become immutable.',
  },
  {
    event: 'DECLINE',
    from: ['SENT', 'NEGOTIATION'],
    to: 'DECLINED',
    actors: ['HUMAN'],
    permissions: ['contract:accept:own'],
    party: 'EXPERT',
    risk: 'MEDIUM',
    financial: false,
    description: 'Expert declines the contract.',
  },
  {
    event: 'CANCEL',
    from: ['DRAFT', 'SENT', 'NEGOTIATION'],
    to: 'CANCELLED',
    actors: ['HUMAN'],
    permissions: CUSTOMER_OWNS,
    party: 'CUSTOMER',
    risk: 'MEDIUM',
    financial: false,
    description: 'Customer withdraws the contract before acceptance.',
  },
  {
    event: 'MARK_FUNDED',
    from: ['ACCEPTED'],
    to: 'FUNDED',
    actors: ['SYSTEM', 'WEBHOOK'],
    risk: 'HIGH',
    financial: true,
    description: 'A milestone on this contract was funded by a verified payment.',
  },
  {
    event: 'START',
    from: ['FUNDED'],
    to: 'ACTIVE',
    actors: ['SYSTEM', 'HUMAN'],
    permissions: ['project:update:any'],
    risk: 'LOW',
    financial: false,
    description: 'Work on the contract begins.',
  },
  {
    event: 'COMPLETE',
    from: ['ACTIVE'],
    to: 'COMPLETED',
    actors: ['SYSTEM'],
    risk: 'MEDIUM',
    financial: false,
    description: 'Every milestone reached a terminal state, at least one approved.',
  },
  {
    event: 'CLOSE',
    from: ['COMPLETED'],
    to: 'CLOSED',
    actors: ['SYSTEM', 'HUMAN'],
    permissions: ['project:update:any'],
    risk: 'LOW',
    financial: false,
    description: 'Reviews and payouts settled; the contract is closed.',
  },
  {
    event: 'RAISE_DISPUTE',
    from: ['FUNDED', 'ACTIVE'],
    to: 'DISPUTED',
    actors: ['HUMAN'],
    permissions: ['dispute:create:own'],
    risk: 'MEDIUM',
    financial: false,
    description: 'Either party disputes a funded contract.',
  },
  {
    event: 'RESOLVE_DISPUTE_CONTINUE',
    from: ['DISPUTED'],
    to: 'ACTIVE',
    actors: ['HUMAN'],
    permissions: ['dispute:resolve:any'],
    risk: 'HIGH',
    financial: false,
    description: 'Dispute resolved; work continues.',
  },
  {
    event: 'TERMINATE',
    from: ['ACCEPTED', 'FUNDED', 'ACTIVE', 'DISPUTED'],
    to: 'TERMINATED',
    actors: ['HUMAN'],
    permissions: ['contract:terminate:any'],
    risk: 'HIGH',
    // Terminating a funded contract has escrow consequences; refunds are a
    // separate, human-approved financial flow.
    financial: true,
    description: 'An administrator terminates the contract.',
  },
];

export const CONTRACT_MACHINE: StateMachine<ContractState, ContractEvent, ContractContext> = {
  name: 'Contract',
  states: CONTRACT_STATES,
  initial: 'DRAFT',
  terminal: ['CLOSED', 'DECLINED', 'CANCELLED', 'TERMINATED'],
  transitions,
};

/**
 * Contract lifecycle — STEP 02 §10.2.
 *
 *   DRAFT → SENT → NEGOTIATION → ACCEPTED → FUNDED → ACTIVE → COMPLETED → CLOSED
 *   branches: DECLINED · CANCELLED · DISPUTED · TERMINATED
 *
 * SENT → ACCEPTED is also valid: negotiation is optional. NEGOTIATION → SENT
 * re-sends a revised version.
 *
 * Signed terms are immutable (master spec §14): nothing moves a contract from
 * ACCEPTED or beyond back to DRAFT, SENT or NEGOTIATION. Accepting signs the
 * current version inside the same transaction.
 *
 * Sending is the customer's signed offer; accepting is the expert's
 * countersignature. `party: 'EXPERT'` on ACCEPT is what stops a customer from
 * accepting their own offer.
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

export const CONTRACT_EVENTS = [
  'SEND',
  'REQUEST_CHANGES',
  'RESEND',
  'ACCEPT',
  'DECLINE',
  'CANCEL',
  'MARK_FUNDED',
  'START',
  'COMPLETE',
  'CLOSE',
  'RAISE_DISPUTE',
  'RESOLVE_DISPUTE',
  'TERMINATE',
] as const;

export type ContractEvent = (typeof CONTRACT_EVENTS)[number];

export interface ContractContext {
  /** Supplied only for RESOLVE_DISPUTE: the state the contract was disputed from. */
  readonly previousStatus?: ContractState | undefined;
}

/** States a dispute can be raised from — the terms bind both parties. */
export const CONTRACT_DISPUTABLE: readonly ContractState[] = ['ACCEPTED', 'FUNDED', 'ACTIVE', 'COMPLETED'];

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
    description: 'Customer signs and sends the current version to the expert.',
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
    description: 'Customer signs and sends the revised current version.',
  },
  {
    event: 'ACCEPT',
    // STEP 02 §10.2 runs SENT → NEGOTIATION → ACCEPTED, and negotiation is
    // optional, so acceptance is valid from either. The current (unsuperseded)
    // version is what gets signed.
    from: ['SENT', 'NEGOTIATION'],
    to: 'ACCEPTED',
    actors: ['HUMAN'],
    permissions: ['contract:accept:own'],
    party: 'EXPERT',
    risk: 'HIGH',
    financial: false,
    description: 'Expert countersigns the current version. Terms become immutable.',
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
    // SYSTEM: a project cancellation withdraws its unsigned contracts.
    actors: ['HUMAN', 'SYSTEM'],
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
    actors: ['SYSTEM'],
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
    from: CONTRACT_DISPUTABLE,
    to: 'DISPUTED',
    actors: ['HUMAN'],
    permissions: ['dispute:create:own'],
    risk: 'MEDIUM',
    financial: false,
    description: 'Either party disputes a binding contract.',
  },
  {
    event: 'RESOLVE_DISPUTE',
    from: ['DISPUTED'],
    resolveTo: (context) =>
      context.previousStatus && CONTRACT_DISPUTABLE.includes(context.previousStatus)
        ? context.previousStatus
        : undefined,
    possibleTargets: CONTRACT_DISPUTABLE,
    actors: ['HUMAN'],
    permissions: ['dispute:resolve:any'],
    risk: 'HIGH',
    financial: false,
    whenDescription: 'Cannot determine the state this contract was disputed from.',
    description: 'Dispute resolved; the contract returns to the state it was disputed from.',
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

/**
 * Dispute triage — the operational workflow on `Dispute.status` before a
 * decision (Phase 8).
 *
 *   OPEN → UNDER_REVIEW ⇄ AWAITING_EVIDENCE
 *   OPEN | UNDER_REVIEW | AWAITING_EVIDENCE → ESCALATED → UNDER_REVIEW
 *
 * Deliberately absent: every resolved state. A dispute is decided only by the
 * Phase 6 lifecycle event on the disputed project, contract or milestone
 * (`RESOLVE_DISPUTE`), which restores or closes that record and resolves the
 * dispute in the same transaction. Triage can organise the work; it can never
 * decide it, so there is no second path to a resolution.
 *
 * Every event is human-only and needs `dispute:resolve:any`.
 */

import type { StateMachine, TransitionDefinition } from '../lifecycle/machine';

export const DISPUTE_STATES = [
  'OPEN',
  'UNDER_REVIEW',
  'AWAITING_EVIDENCE',
  'RESOLVED_CUSTOMER',
  'RESOLVED_EXPERT',
  'RESOLVED_SPLIT',
  'WITHDRAWN',
  'ESCALATED',
] as const;

export type DisputeState = (typeof DISPUTE_STATES)[number];

/** Dispute states that still need a decision. Must match the lifecycle engine's list. */
export const DISPUTE_OPEN_STATES: readonly DisputeState[] = ['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE', 'ESCALATED'];

/** States only a lifecycle resolution can produce. */
export const DISPUTE_RESOLVED_STATES: readonly DisputeState[] = [
  'RESOLVED_CUSTOMER',
  'RESOLVED_EXPERT',
  'RESOLVED_SPLIT',
  'WITHDRAWN',
];

export const DISPUTE_TRIAGE_EVENTS = [
  'BEGIN_REVIEW',
  'REQUEST_EVIDENCE',
  'RESUME_REVIEW',
  'ESCALATE',
  'RETURN_TO_REVIEW',
] as const;

export type DisputeTriageEvent = (typeof DISPUTE_TRIAGE_EVENTS)[number];

export type DisputeTriageContext = Record<string, never>;

const RESOLVE = ['dispute:resolve:any'] as const;

type Def = TransitionDefinition<DisputeState, DisputeTriageEvent, DisputeTriageContext>;

const transitions: readonly Def[] = [
  {
    event: 'BEGIN_REVIEW',
    from: ['OPEN'],
    to: 'UNDER_REVIEW',
    actors: ['HUMAN'],
    permissions: RESOLVE,
    risk: 'LOW',
    financial: false,
    description: 'An administrator takes the dispute into review.',
  },
  {
    event: 'REQUEST_EVIDENCE',
    from: ['UNDER_REVIEW'],
    to: 'AWAITING_EVIDENCE',
    actors: ['HUMAN'],
    permissions: RESOLVE,
    risk: 'MEDIUM',
    financial: false,
    description: 'The parties are asked for evidence. The request is the reason.',
  },
  {
    event: 'RESUME_REVIEW',
    from: ['AWAITING_EVIDENCE'],
    to: 'UNDER_REVIEW',
    actors: ['HUMAN'],
    permissions: RESOLVE,
    risk: 'LOW',
    financial: false,
    description: 'Evidence received; review continues.',
  },
  {
    event: 'ESCALATE',
    from: ['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE'],
    to: 'ESCALATED',
    actors: ['HUMAN'],
    permissions: RESOLVE,
    risk: 'MEDIUM',
    financial: false,
    description: 'The dispute is escalated for senior attention.',
  },
  {
    event: 'RETURN_TO_REVIEW',
    from: ['ESCALATED'],
    to: 'UNDER_REVIEW',
    actors: ['HUMAN'],
    permissions: RESOLVE,
    risk: 'MEDIUM',
    financial: false,
    description: 'An escalated dispute returns to ordinary review.',
  },
];

export const DISPUTE_TRIAGE_MACHINE: StateMachine<DisputeState, DisputeTriageEvent, DisputeTriageContext> = {
  name: 'DisputeTriage',
  states: DISPUTE_STATES,
  initial: 'OPEN',
  terminal: DISPUTE_RESOLVED_STATES,
  transitions,
};

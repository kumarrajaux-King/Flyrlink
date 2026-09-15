/**
 * Milestone lifecycle — STEP 02 §10.3.
 *
 *   DRAFT → PENDING_FUNDING → FUNDED → IN_PROGRESS → SUBMITTED → IN_REVIEW → APPROVED
 *   REVISION_REQUESTED → IN_PROGRESS        (loop; revision count is a performance signal)
 *   branches: DISPUTED → RESOLVED · CANCELLED
 *
 * IN_REVIEW → REVISION_REQUESTED opens the revision loop.
 *
 * The two transitions that touch money are protected in both directions:
 *
 *   - MARK_FUNDED is SYSTEM-only, and the service additionally requires a linked
 *     payment that a verified webhook confirmed, for at least the milestone's
 *     amount in the milestone's currency.
 *   - APPROVE is human-only and HIGH risk, because approval is what makes escrow
 *     eligible for release. An AI can never approve work.
 */

import type { StateMachine, TransitionDefinition } from '../lifecycle/machine';

export const MILESTONE_STATES = [
  'DRAFT',
  'PENDING_FUNDING',
  'FUNDED',
  'IN_PROGRESS',
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED',
  'REVISION_REQUESTED',
  'DISPUTED',
  'RESOLVED',
  'CANCELLED',
] as const;

export type MilestoneState = (typeof MILESTONE_STATES)[number];

export const MILESTONE_EVENTS = [
  'OPEN_FOR_FUNDING',
  'MARK_FUNDED',
  'START',
  'SUBMIT',
  'BEGIN_REVIEW',
  'APPROVE',
  'REQUEST_REVISION',
  'RAISE_DISPUTE',
  'RESOLVE_DISPUTE',
  'CANCEL',
  'CANCEL_FUNDED',
] as const;

export type MilestoneEvent = (typeof MILESTONE_EVENTS)[number];

export type MilestoneContext = Record<string, never>;

/** Milestone states that mean escrow was funded by a verified payment. */
export const MILESTONE_FUNDED_OR_LATER: readonly MilestoneState[] = [
  'FUNDED',
  'IN_PROGRESS',
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED',
  'REVISION_REQUESTED',
];

const CUSTOMER_REVIEW = ['milestone:approve:own', 'milestone:approve:any'] as const;
const CUSTOMER_OWNS = ['contract:create:own', 'project:update:any'] as const;

type Def = TransitionDefinition<MilestoneState, MilestoneEvent, MilestoneContext>;

const transitions: readonly Def[] = [
  {
    event: 'OPEN_FOR_FUNDING',
    from: ['DRAFT'],
    to: 'PENDING_FUNDING',
    actors: ['HUMAN', 'SYSTEM'],
    permissions: CUSTOMER_OWNS,
    party: 'CUSTOMER',
    risk: 'MEDIUM',
    financial: false,
    description: 'Milestone finalised and opened for funding. Requires signed contract terms.',
  },
  {
    event: 'MARK_FUNDED',
    from: ['PENDING_FUNDING'],
    to: 'FUNDED',
    actors: ['SYSTEM'],
    risk: 'HIGH',
    financial: true,
    description: 'A webhook-confirmed payment funded this milestone into escrow.',
  },
  {
    event: 'START',
    from: ['FUNDED', 'REVISION_REQUESTED'],
    to: 'IN_PROGRESS',
    actors: ['HUMAN'],
    permissions: ['milestone:submit:own'],
    party: 'EXPERT',
    risk: 'LOW',
    financial: false,
    description: 'Expert starts, or resumes after a revision request.',
  },
  {
    event: 'SUBMIT',
    from: ['IN_PROGRESS'],
    to: 'SUBMITTED',
    actors: ['HUMAN'],
    permissions: ['milestone:submit:own'],
    party: 'EXPERT',
    risk: 'MEDIUM',
    financial: false,
    description: 'Expert submits the work. Requires at least one submitted deliverable.',
  },
  {
    event: 'BEGIN_REVIEW',
    from: ['SUBMITTED'],
    to: 'IN_REVIEW',
    actors: ['HUMAN', 'SYSTEM'],
    permissions: CUSTOMER_REVIEW,
    party: 'CUSTOMER',
    risk: 'LOW',
    financial: false,
    description: 'Customer opens the submission for review.',
  },
  {
    event: 'APPROVE',
    from: ['IN_REVIEW'],
    to: 'APPROVED',
    actors: ['HUMAN'],
    permissions: CUSTOMER_REVIEW,
    party: 'CUSTOMER',
    risk: 'HIGH',
    // Approval makes escrow release-eligible. It does not itself release money:
    // release is a separate, finance-only payment transition.
    financial: true,
    description: 'Customer accepts the work against its acceptance criteria.',
  },
  {
    event: 'REQUEST_REVISION',
    from: ['IN_REVIEW'],
    to: 'REVISION_REQUESTED',
    actors: ['HUMAN'],
    permissions: CUSTOMER_REVIEW,
    party: 'CUSTOMER',
    risk: 'LOW',
    financial: false,
    description: 'Customer requests changes. Increments revisionCount.',
  },
  {
    event: 'RAISE_DISPUTE',
    from: ['FUNDED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW', 'REVISION_REQUESTED'],
    to: 'DISPUTED',
    actors: ['HUMAN'],
    permissions: ['dispute:create:own'],
    risk: 'MEDIUM',
    financial: false,
    description: 'Either party disputes a funded milestone.',
  },
  {
    event: 'RESOLVE_DISPUTE',
    from: ['DISPUTED'],
    to: 'RESOLVED',
    actors: ['HUMAN'],
    permissions: ['dispute:resolve:any'],
    risk: 'HIGH',
    financial: true,
    description: 'An administrator resolves the dispute. Awards are settled separately.',
  },
  {
    event: 'CANCEL',
    from: ['DRAFT', 'PENDING_FUNDING'],
    to: 'CANCELLED',
    // SYSTEM: a project cancellation withdraws its unfunded milestones.
    actors: ['HUMAN', 'SYSTEM'],
    permissions: CUSTOMER_OWNS,
    party: 'CUSTOMER',
    risk: 'MEDIUM',
    financial: false,
    description: 'Cancelled before funding. Refused while a payment is in flight or captured.',
  },
  {
    event: 'CANCEL_FUNDED',
    from: ['FUNDED'],
    to: 'CANCELLED',
    actors: ['HUMAN'],
    permissions: ['project:update:any'],
    risk: 'HIGH',
    financial: true,
    description: 'An administrator cancels a funded milestone once its funds are in the refund flow.',
  },
];

export const MILESTONE_MACHINE: StateMachine<MilestoneState, MilestoneEvent, MilestoneContext> = {
  name: 'Milestone',
  states: MILESTONE_STATES,
  initial: 'DRAFT',
  terminal: ['APPROVED', 'RESOLVED', 'CANCELLED'],
  transitions,
};

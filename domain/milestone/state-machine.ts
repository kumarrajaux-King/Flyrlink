/**
 * Milestone lifecycle — STEP 02 §10.3.
 *
 *   DRAFT → PENDING_FUNDING → FUNDED → IN_PROGRESS → SUBMITTED → IN_REVIEW → APPROVED
 *   IN_REVIEW → REVISION_REQUESTED → IN_PROGRESS   (loop; revisionCount is a signal)
 *   branches: DISPUTED → RESOLVED · CANCELLED
 *
 * The two transitions that touch money are protected in both directions:
 *
 *   - MARK_FUNDED can only come from SYSTEM or WEBHOOK, and the service requires
 *     a linked payment that a verified webhook confirmed.
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

export type MilestoneEvent =
  | 'OPEN_FOR_FUNDING'
  | 'MARK_FUNDED'
  | 'START'
  | 'SUBMIT'
  | 'BEGIN_REVIEW'
  | 'APPROVE'
  | 'REQUEST_REVISION'
  | 'RAISE_DISPUTE'
  | 'RESOLVE_DISPUTE'
  | 'CANCEL'
  | 'CANCEL_FUNDED';

export type MilestoneContext = Record<string, never>;

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
    description: 'Milestone finalised and opened for funding. Requires an accepted contract.',
  },
  {
    event: 'MARK_FUNDED',
    from: ['PENDING_FUNDING'],
    to: 'FUNDED',
    actors: ['SYSTEM', 'WEBHOOK'],
    risk: 'HIGH',
    financial: true,
    description: 'A verified payment funded this milestone into escrow.',
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
    description: 'Expert submits the work. Requires at least one deliverable.',
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
    from: ['IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW', 'REVISION_REQUESTED'],
    to: 'DISPUTED',
    actors: ['HUMAN'],
    permissions: ['dispute:create:own'],
    risk: 'MEDIUM',
    financial: false,
    description: 'Either party disputes the milestone.',
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
    actors: ['HUMAN'],
    permissions: CUSTOMER_OWNS,
    party: 'CUSTOMER',
    risk: 'MEDIUM',
    financial: false,
    description: 'Cancelled before funding. Guarded against a captured payment.',
  },
  {
    event: 'CANCEL_FUNDED',
    from: ['FUNDED'],
    to: 'CANCELLED',
    actors: ['HUMAN'],
    permissions: ['project:update:any'],
    risk: 'HIGH',
    financial: true,
    description: 'An administrator cancels a funded milestone. Any refund is a separate flow.',
  },
];

export const MILESTONE_MACHINE: StateMachine<MilestoneState, MilestoneEvent, MilestoneContext> = {
  name: 'Milestone',
  states: MILESTONE_STATES,
  initial: 'DRAFT',
  terminal: ['APPROVED', 'RESOLVED', 'CANCELLED'],
  transitions,
};

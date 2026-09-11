/**
 * Project lifecycle — STEP 02 §10.1, made source-aware for A-01.
 *
 * The unified Project spine serves three entry flows, which diverge right after
 * submission and converge at CONTRACT_PENDING:
 *
 *   POSTED_PROJECT      SUBMITTED → AI_ANALYSIS → REQUIREMENT_REVIEW → MATCHING
 *                         → RECOMMENDED → AWAITING_APPROVAL → ASSIGNMENT_PENDING
 *   DIRECT_HIRE         SUBMITTED → ASSIGNMENT_PENDING   (the invited expert)
 *   PREDEFINED_SERVICE  SUBMITTED → CONTRACT_PENDING     (the service is the scope)
 *
 *   all:  CONTRACT_PENDING → PAYMENT_PENDING → ACTIVE ⇄ AT_RISK
 *           → COMPLETED → REVIEW_PENDING → CLOSED
 *
 * Every divergence is a `when` guard on the entry source, so the machine stays
 * deterministic: a POSTED project cannot take the DIRECT_HIRE branch.
 */

import type { StateMachine, TransitionDefinition } from '../lifecycle/machine';

export const PROJECT_STATES = [
  'DRAFT',
  'SUBMITTED',
  'AI_ANALYSIS',
  'REQUIREMENT_REVIEW',
  'MATCHING',
  'RECOMMENDED',
  'AWAITING_APPROVAL',
  'ASSIGNMENT_PENDING',
  'CONTRACT_PENDING',
  'PAYMENT_PENDING',
  'ACTIVE',
  'AT_RISK',
  'COMPLETED',
  'REVIEW_PENDING',
  'CLOSED',
  'CANCELLED',
  'DISPUTED',
  'SUSPENDED',
] as const;

export type ProjectState = (typeof PROJECT_STATES)[number];

export type ProjectSource = 'DIRECT_HIRE' | 'POSTED_PROJECT' | 'PREDEFINED_SERVICE';

export interface ProjectContext {
  readonly source: ProjectSource;
  /** Supplied only for RESUME: the state the project was suspended from. */
  readonly previousStatus?: ProjectState | undefined;
}

export type ProjectEvent =
  | 'SUBMIT'
  | 'START_ANALYSIS'
  | 'COMPLETE_ANALYSIS'
  | 'REQUEST_REANALYSIS'
  | 'APPROVE_REQUIREMENTS'
  | 'PUBLISH_RECOMMENDATIONS'
  | 'SHORTLIST'
  | 'REQUEST_ALTERNATIVES'
  | 'APPROVE_ASSIGNMENT'
  | 'INVITE_DIRECT'
  | 'PREPARE_SERVICE_CONTRACT'
  | 'ACCEPT_ASSIGNMENT'
  | 'DECLINE_ASSIGNMENT'
  | 'DECLINE_INVITATION'
  | 'MARK_CONTRACT_ACCEPTED'
  | 'ACTIVATE'
  | 'MARK_AT_RISK'
  | 'RESOLVE_RISK'
  | 'COMPLETE'
  | 'REQUEST_REVIEWS'
  | 'CLOSE'
  | 'CANCEL'
  | 'RAISE_DISPUTE'
  | 'RESOLVE_DISPUTE_CONTINUE'
  | 'RESOLVE_DISPUTE_CLOSE'
  | 'SUSPEND'
  | 'RESUME';

/** States a customer may still cancel from — before any money moves. */
export const PROJECT_CANCELLABLE: readonly ProjectState[] = [
  'DRAFT',
  'SUBMITTED',
  'AI_ANALYSIS',
  'REQUIREMENT_REVIEW',
  'MATCHING',
  'RECOMMENDED',
  'AWAITING_APPROVAL',
  'ASSIGNMENT_PENDING',
  'CONTRACT_PENDING',
  'PAYMENT_PENDING',
];

/** Every non-terminal state except SUSPENDED itself. */
export const PROJECT_SUSPENDABLE: readonly ProjectState[] = PROJECT_STATES.filter(
  (state) => state !== 'CLOSED' && state !== 'CANCELLED' && state !== 'SUSPENDED',
);

const CUSTOMER_EDIT = ['project:update:own', 'project:update:any'] as const;

type Def = TransitionDefinition<ProjectState, ProjectEvent, ProjectContext>;

const transitions: readonly Def[] = [
  {
    event: 'SUBMIT',
    from: ['DRAFT'],
    to: 'SUBMITTED',
    actors: ['HUMAN'],
    permissions: ['project:submit:own'],
    party: 'CUSTOMER',
    risk: 'LOW',
    financial: false,
    description: 'Customer submits the drafted project.',
  },
  {
    event: 'START_ANALYSIS',
    from: ['SUBMITTED'],
    to: 'AI_ANALYSIS',
    actors: ['SYSTEM'],
    risk: 'LOW',
    financial: false,
    when: (context) => context.source === 'POSTED_PROJECT',
    whenDescription: 'Only a POSTED_PROJECT goes through AI analysis.',
    description: 'The intake pipeline begins AI requirement analysis.',
  },
  {
    event: 'COMPLETE_ANALYSIS',
    from: ['AI_ANALYSIS'],
    to: 'REQUIREMENT_REVIEW',
    actors: ['SYSTEM'],
    risk: 'LOW',
    financial: false,
    description: 'Analysis finished; requirements await customer review.',
  },
  {
    event: 'REQUEST_REANALYSIS',
    from: ['REQUIREMENT_REVIEW'],
    to: 'AI_ANALYSIS',
    actors: ['HUMAN'],
    permissions: CUSTOMER_EDIT,
    party: 'CUSTOMER',
    risk: 'LOW',
    financial: false,
    description: 'Customer rejects the analysis and asks for another pass.',
  },
  {
    event: 'APPROVE_REQUIREMENTS',
    from: ['REQUIREMENT_REVIEW'],
    to: 'MATCHING',
    actors: ['HUMAN'],
    permissions: CUSTOMER_EDIT,
    party: 'CUSTOMER',
    risk: 'MEDIUM',
    financial: false,
    description: 'Customer approves the AI-structured requirements.',
  },
  {
    event: 'PUBLISH_RECOMMENDATIONS',
    from: ['MATCHING'],
    to: 'RECOMMENDED',
    actors: ['SYSTEM'],
    risk: 'LOW',
    financial: false,
    description: 'Matching finished; ranked recommendations are ready.',
  },
  {
    event: 'SHORTLIST',
    from: ['RECOMMENDED'],
    to: 'AWAITING_APPROVAL',
    actors: ['HUMAN'],
    permissions: CUSTOMER_EDIT,
    party: 'CUSTOMER',
    risk: 'LOW',
    financial: false,
    description: 'Customer shortlists a recommendation for approval.',
  },
  {
    event: 'REQUEST_ALTERNATIVES',
    from: ['RECOMMENDED', 'AWAITING_APPROVAL'],
    to: 'MATCHING',
    actors: ['HUMAN'],
    permissions: CUSTOMER_EDIT,
    party: 'CUSTOMER',
    risk: 'LOW',
    financial: false,
    description: 'Customer asks for different recommendations.',
  },
  {
    event: 'APPROVE_ASSIGNMENT',
    from: ['AWAITING_APPROVAL'],
    to: 'ASSIGNMENT_PENDING',
    actors: ['HUMAN'],
    permissions: CUSTOMER_EDIT,
    party: 'CUSTOMER',
    risk: 'HIGH',
    financial: false,
    description: 'Customer approves the recommended expert; they are invited.',
  },
  {
    event: 'INVITE_DIRECT',
    from: ['SUBMITTED'],
    to: 'ASSIGNMENT_PENDING',
    actors: ['HUMAN', 'SYSTEM'],
    permissions: ['project:submit:own', 'project:update:any'],
    party: 'CUSTOMER',
    risk: 'MEDIUM',
    financial: false,
    when: (context) => context.source === 'DIRECT_HIRE',
    whenDescription: 'Only a DIRECT_HIRE project invites an expert directly.',
    description: 'The expert the customer chose is invited.',
  },
  {
    event: 'PREPARE_SERVICE_CONTRACT',
    from: ['SUBMITTED'],
    to: 'CONTRACT_PENDING',
    actors: ['SYSTEM'],
    risk: 'LOW',
    financial: false,
    when: (context) => context.source === 'PREDEFINED_SERVICE',
    whenDescription: 'Only a PREDEFINED_SERVICE project skips straight to its contract.',
    description: 'A catalog purchase moves directly to its service contract.',
  },
  {
    event: 'ACCEPT_ASSIGNMENT',
    from: ['ASSIGNMENT_PENDING'],
    to: 'CONTRACT_PENDING',
    actors: ['HUMAN'],
    permissions: ['assignment:respond:own'],
    party: 'EXPERT',
    risk: 'HIGH',
    financial: false,
    description: 'The invited expert accepts; a contract can be drafted.',
  },
  {
    event: 'DECLINE_ASSIGNMENT',
    from: ['ASSIGNMENT_PENDING'],
    to: 'MATCHING',
    actors: ['HUMAN'],
    permissions: ['assignment:respond:own'],
    party: 'EXPERT',
    risk: 'MEDIUM',
    financial: false,
    when: (context) => context.source === 'POSTED_PROJECT',
    whenDescription: 'Declining returns a POSTED_PROJECT to matching.',
    description: 'The recommended expert declines; matching resumes.',
  },
  {
    event: 'DECLINE_INVITATION',
    from: ['ASSIGNMENT_PENDING'],
    to: 'DRAFT',
    actors: ['HUMAN'],
    permissions: ['assignment:respond:own'],
    party: 'EXPERT',
    risk: 'MEDIUM',
    financial: false,
    when: (context) => context.source === 'DIRECT_HIRE',
    whenDescription: 'Declining returns a DIRECT_HIRE project to draft for re-invitation.',
    description: 'The directly invited expert declines; the customer may invite another.',
  },
  {
    event: 'MARK_CONTRACT_ACCEPTED',
    from: ['CONTRACT_PENDING'],
    to: 'PAYMENT_PENDING',
    actors: ['SYSTEM'],
    risk: 'MEDIUM',
    financial: false,
    description: 'A contract was accepted; the first milestone awaits funding.',
  },
  {
    event: 'ACTIVATE',
    from: ['PAYMENT_PENDING'],
    to: 'ACTIVE',
    actors: ['SYSTEM', 'WEBHOOK'],
    risk: 'HIGH',
    financial: true,
    description: 'A milestone was funded by a verified payment; work may begin.',
  },
  {
    event: 'MARK_AT_RISK',
    from: ['ACTIVE'],
    to: 'AT_RISK',
    // The ONLY project event an AI agent may fire. Reversible and non-financial.
    actors: ['HUMAN', 'SYSTEM', 'AI_AGENT'],
    permissions: ['project:update:any'],
    risk: 'MEDIUM',
    financial: false,
    description: 'Delivery risk detected (deadline, scope, inactivity).',
  },
  {
    event: 'RESOLVE_RISK',
    from: ['AT_RISK'],
    to: 'ACTIVE',
    actors: ['HUMAN', 'SYSTEM'],
    permissions: ['project:update:any'],
    risk: 'LOW',
    financial: false,
    description: 'The risk has been addressed.',
  },
  {
    event: 'COMPLETE',
    from: ['ACTIVE', 'AT_RISK'],
    to: 'COMPLETED',
    actors: ['SYSTEM'],
    risk: 'MEDIUM',
    financial: false,
    description: 'Every contract on the project is complete.',
  },
  {
    event: 'REQUEST_REVIEWS',
    from: ['COMPLETED'],
    to: 'REVIEW_PENDING',
    actors: ['SYSTEM'],
    risk: 'LOW',
    financial: false,
    description: 'Both parties are invited to review.',
  },
  {
    event: 'CLOSE',
    from: ['REVIEW_PENDING'],
    to: 'CLOSED',
    actors: ['HUMAN', 'SYSTEM'],
    permissions: ['project:update:any'],
    risk: 'LOW',
    financial: false,
    description: 'The project is closed.',
  },
  {
    event: 'CANCEL',
    from: PROJECT_CANCELLABLE,
    to: 'CANCELLED',
    actors: ['HUMAN'],
    permissions: ['project:cancel:own', 'project:update:any'],
    party: 'CUSTOMER',
    risk: 'MEDIUM',
    financial: false,
    description: 'Cancelled before any money moved. Guarded against a captured payment.',
  },
  {
    event: 'RAISE_DISPUTE',
    from: ['ACTIVE', 'AT_RISK', 'COMPLETED', 'REVIEW_PENDING'],
    to: 'DISPUTED',
    actors: ['HUMAN'],
    permissions: ['dispute:create:own'],
    risk: 'MEDIUM',
    financial: false,
    description: 'Either party disputes the engagement.',
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
    event: 'RESOLVE_DISPUTE_CLOSE',
    from: ['DISPUTED'],
    to: 'CLOSED',
    actors: ['HUMAN'],
    permissions: ['dispute:resolve:any'],
    risk: 'HIGH',
    financial: false,
    description: 'Dispute resolved by ending the engagement.',
  },
  {
    event: 'SUSPEND',
    from: PROJECT_SUSPENDABLE,
    to: 'SUSPENDED',
    actors: ['HUMAN'],
    permissions: ['project:update:any'],
    risk: 'HIGH',
    financial: false,
    description: 'An administrator suspends the project (policy, fraud, investigation).',
  },
  {
    event: 'RESUME',
    from: ['SUSPENDED'],
    resolveTo: (context) =>
      context.previousStatus && PROJECT_SUSPENDABLE.includes(context.previousStatus)
        ? context.previousStatus
        : undefined,
    possibleTargets: PROJECT_SUSPENDABLE,
    actors: ['HUMAN'],
    permissions: ['project:update:any'],
    risk: 'HIGH',
    financial: false,
    whenDescription: 'Cannot determine the state this project was suspended from.',
    description: 'Suspension lifted; the project returns to the state it was suspended from.',
  },
];

export const PROJECT_MACHINE: StateMachine<ProjectState, ProjectEvent, ProjectContext> = {
  name: 'Project',
  states: PROJECT_STATES,
  initial: 'DRAFT',
  terminal: ['CLOSED', 'CANCELLED'],
  transitions,
};

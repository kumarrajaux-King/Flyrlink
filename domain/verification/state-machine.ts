/**
 * Expert verification — the human review workflow on `ExpertVerification.status`
 * (Phase 8).
 *
 *   PENDING → IN_REVIEW → VERIFIED | REJECTED
 *   IN_REVIEW → PENDING            more information requested from the expert
 *   VERIFIED → REVOKED
 *
 * Blueprint rule 6 and STEP 01 §11: AI never grants verification. The
 * Verification Agent may write findings and flags onto the record; every event
 * here is human-only, and the only route to VERIFIED is APPROVE by a holder of
 * `expert:verify:any`.
 *
 * "More information requested" needs no new status value. It is PENDING with a
 * review recorded after the latest submission (`reviewedAt >= submittedAt`).
 * When the expert resubmits, `submittedAt` moves past `reviewedAt` and the case
 * is back in the reviewers' queue. `verificationStage` derives this.
 */

import type { StateMachine, TransitionDefinition } from '../lifecycle/machine';

export const VERIFICATION_STATES = [
  'UNVERIFIED',
  'PENDING',
  'IN_REVIEW',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
  'REVOKED',
] as const;

export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const VERIFICATION_EVENTS = ['START_REVIEW', 'REQUEST_INFORMATION', 'APPROVE', 'REJECT', 'REVOKE'] as const;

export type VerificationEvent = (typeof VERIFICATION_EVENTS)[number];

export type VerificationContext = Record<string, never>;

const VERIFY = ['expert:verify:any'] as const;

type Def = TransitionDefinition<VerificationState, VerificationEvent, VerificationContext>;

const transitions: readonly Def[] = [
  {
    event: 'START_REVIEW',
    from: ['PENDING'],
    to: 'IN_REVIEW',
    actors: ['HUMAN'],
    permissions: VERIFY,
    risk: 'LOW',
    financial: false,
    description: 'A verification manager claims the case. Refused while the expert owes more information.',
  },
  {
    event: 'REQUEST_INFORMATION',
    from: ['IN_REVIEW'],
    to: 'PENDING',
    actors: ['HUMAN'],
    permissions: VERIFY,
    risk: 'MEDIUM',
    financial: false,
    description: 'The reviewer asks the expert for more evidence. The request is the reason.',
  },
  {
    event: 'APPROVE',
    from: ['IN_REVIEW'],
    to: 'VERIFIED',
    actors: ['HUMAN'],
    permissions: VERIFY,
    risk: 'HIGH',
    financial: false,
    description: 'A human grants verified status. AI flags must be explicitly acknowledged.',
  },
  {
    event: 'REJECT',
    from: ['IN_REVIEW'],
    to: 'REJECTED',
    actors: ['HUMAN'],
    permissions: VERIFY,
    risk: 'HIGH',
    financial: false,
    description: 'A human refuses verification.',
  },
  {
    event: 'REVOKE',
    from: ['VERIFIED'],
    to: 'REVOKED',
    actors: ['HUMAN'],
    permissions: VERIFY,
    risk: 'HIGH',
    financial: false,
    description: 'Verified status is withdrawn; the public badge goes with it.',
  },
];

export const VERIFICATION_MACHINE: StateMachine<VerificationState, VerificationEvent, VerificationContext> = {
  name: 'Verification',
  states: VERIFICATION_STATES,
  initial: 'PENDING',
  terminal: ['REJECTED', 'EXPIRED', 'REVOKED'],
  transitions,
};

/** Where a case sits in the reviewers' workflow. */
export const VERIFICATION_STAGES = ['AWAITING_REVIEW', 'IN_REVIEW', 'AWAITING_EXPERT', 'DECIDED'] as const;

export type VerificationStage = (typeof VERIFICATION_STAGES)[number];

export function verificationStage(record: {
  readonly status: string;
  readonly submittedAt: Date;
  readonly reviewedAt: Date | null;
}): VerificationStage {
  if (record.status === 'IN_REVIEW') return 'IN_REVIEW';
  if (record.status === 'PENDING') {
    return record.reviewedAt !== null && record.reviewedAt.getTime() >= record.submittedAt.getTime()
      ? 'AWAITING_EXPERT'
      : 'AWAITING_REVIEW';
  }
  return 'DECIDED';
}

/**
 * Review moderation — the administrative workflow on `Review.status` (Phase 8).
 *
 *   PUBLISHED | FLAGGED → UNDER_MODERATION → PUBLISHED | HIDDEN | REJECTED
 *   PUBLISHED | FLAGGED → HIDDEN → PUBLISHED
 *
 * Moderation changes a review's visibility, never its content: there is no
 * event that edits the rating or the comment. PENDING reviews are out of reach
 * — publishing them belongs to the review flow (Phase 11), not to a moderator.
 * REJECTED is final.
 *
 * Every event is human-only and needs `review:moderate:any`.
 */

import type { StateMachine, TransitionDefinition } from '../lifecycle/machine';

export const REVIEW_STATES = ['PENDING', 'PUBLISHED', 'FLAGGED', 'UNDER_MODERATION', 'REJECTED', 'HIDDEN'] as const;

export type ReviewState = (typeof REVIEW_STATES)[number];

export const REVIEW_MODERATION_EVENTS = ['TAKE_FOR_MODERATION', 'PUBLISH', 'HIDE', 'REINSTATE', 'REJECT'] as const;

export type ReviewModerationEvent = (typeof REVIEW_MODERATION_EVENTS)[number];

export type ReviewModerationContext = Record<string, never>;

const MODERATE = ['review:moderate:any'] as const;

type Def = TransitionDefinition<ReviewState, ReviewModerationEvent, ReviewModerationContext>;

const transitions: readonly Def[] = [
  {
    event: 'TAKE_FOR_MODERATION',
    from: ['PUBLISHED', 'FLAGGED'],
    to: 'UNDER_MODERATION',
    actors: ['HUMAN'],
    permissions: MODERATE,
    risk: 'LOW',
    financial: false,
    description: 'A moderator opens the review for a decision.',
  },
  {
    event: 'PUBLISH',
    from: ['UNDER_MODERATION'],
    to: 'PUBLISHED',
    actors: ['HUMAN'],
    permissions: MODERATE,
    risk: 'MEDIUM',
    financial: false,
    description: 'The review stands. Only a verified-transaction review may be published.',
  },
  {
    event: 'HIDE',
    from: ['PUBLISHED', 'FLAGGED', 'UNDER_MODERATION'],
    to: 'HIDDEN',
    actors: ['HUMAN'],
    permissions: MODERATE,
    risk: 'MEDIUM',
    financial: false,
    description: 'The review is withdrawn from public view, reversibly.',
  },
  {
    event: 'REINSTATE',
    from: ['HIDDEN'],
    to: 'PUBLISHED',
    actors: ['HUMAN'],
    permissions: MODERATE,
    risk: 'MEDIUM',
    financial: false,
    description: 'A hidden review is restored to public view.',
  },
  {
    event: 'REJECT',
    from: ['FLAGGED', 'UNDER_MODERATION'],
    to: 'REJECTED',
    actors: ['HUMAN'],
    permissions: MODERATE,
    risk: 'HIGH',
    financial: false,
    description: 'The review is permanently refused publication.',
  },
];

export const REVIEW_MODERATION_MACHINE: StateMachine<ReviewState, ReviewModerationEvent, ReviewModerationContext> = {
  name: 'ReviewModeration',
  states: REVIEW_STATES,
  initial: 'PENDING',
  terminal: ['REJECTED'],
  transitions,
};

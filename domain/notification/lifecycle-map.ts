/**
 * Which lifecycle transitions tell somebody something, and whom.
 *
 * One table, pure, keyed by entity type and event. The Phase 6 engine consults
 * it after a transition commits its write; an event that is absent notifies
 * nobody, which is the default and needs no entry.
 *
 * WHY THIS IS A TABLE AND NOT CODE INSIDE THE FOUR SERVICES
 *   The alternative — each lifecycle service emitting its own notifications —
 *   spreads "who hears about what" across four files and makes the honest
 *   question ("does the expert learn when the customer funds a milestone?")
 *   answerable only by reading all of them. Here it is one grep. The four
 *   services were not touched to add this.
 *
 * AUDIENCE, NOT RECIPIENTS
 *   The table names *sides* — customer, expert, both — not user ids. The engine
 *   resolves a side to the actual participants of that record, and the routing
 *   rules then drop the person who caused the event. So a table entry is a
 *   statement about the engagement, not about a particular user.
 *
 * The copy here is intentionally flat and factual: no urgency, no marketing
 * tone, no promise of a date or an amount. Where a figure or a name belongs in
 * the text, it is the Communication Agent's job to draft it (Phase 7) — this
 * table is the fallback that always works, including when no AI is available.
 */

import type { NotificationType } from './routing';

export type LifecycleEntity = 'Project' | 'Contract' | 'Milestone' | 'Payment';

/** Which side of the engagement hears about a transition. */
export type Audience = 'CUSTOMER' | 'EXPERT' | 'BOTH';

export interface LifecycleNotification {
  readonly type: NotificationType;
  readonly audience: Audience;
  readonly title: string;
  readonly body: string;
}

type EntityMap = Partial<Record<string, LifecycleNotification>>;

const PROJECT: EntityMap = {
  COMPLETE_ANALYSIS: {
    type: 'PROJECT_ANALYZED',
    audience: 'CUSTOMER',
    title: 'Your project has been analysed',
    body: 'The requirements drafted for your project are ready for you to review and edit.',
  },
  PUBLISH_RECOMMENDATIONS: {
    type: 'EXPERT_RECOMMENDED',
    audience: 'CUSTOMER',
    title: 'Recommended experts are ready',
    body: 'Matching experts have been proposed for your project. Nothing is committed until you decide.',
  },
  INVITE_DIRECT: {
    type: 'EXPERT_INVITED',
    audience: 'EXPERT',
    title: 'You have been invited to a project',
    body: 'A customer has invited you to take on a project. Review the brief and respond.',
  },
  APPROVE_ASSIGNMENT: {
    type: 'EXPERT_INVITED',
    audience: 'EXPERT',
    title: 'You have been selected for a project',
    body: 'A customer has selected you for a project. Review the brief and respond.',
  },
  ACCEPT_ASSIGNMENT: {
    type: 'EXPERT_ACCEPTED',
    audience: 'CUSTOMER',
    title: 'The expert accepted',
    body: 'The expert has accepted the assignment. A contract can now be prepared.',
  },
  DECLINE_ASSIGNMENT: {
    type: 'EXPERT_RECOMMENDED',
    audience: 'CUSTOMER',
    title: 'The expert declined',
    body: 'The expert declined the assignment. You can select another from your recommendations.',
  },
  DECLINE_INVITATION: {
    type: 'EXPERT_RECOMMENDED',
    audience: 'CUSTOMER',
    title: 'The expert declined your invitation',
    body: 'The expert declined your invitation. You can invite someone else or post the project.',
  },
  ACTIVATE: {
    type: 'PROJECT_CREATED',
    audience: 'BOTH',
    title: 'The project is active',
    body: 'Work on this project has started.',
  },
  MARK_AT_RISK: {
    type: 'PROJECT_AT_RISK',
    audience: 'BOTH',
    title: 'This project has been flagged as at risk',
    body: 'A risk has been recorded against this project. Review the details and decide what to do.',
  },
  COMPLETE: {
    type: 'PROJECT_COMPLETED',
    audience: 'BOTH',
    title: 'The project is complete',
    body: 'All work on this project is finished.',
  },
  REQUEST_REVIEWS: {
    type: 'REVIEW_REQUESTED',
    audience: 'BOTH',
    title: 'A review has been requested',
    body: 'You can now leave a review for this engagement.',
  },
  RAISE_DISPUTE: {
    type: 'DISPUTE_OPENED',
    audience: 'BOTH',
    title: 'A dispute has been opened',
    body: 'A dispute has been opened on this project. Payouts on it are held while it is reviewed.',
  },
  RESOLVE_DISPUTE: {
    type: 'DISPUTE_RESOLVED',
    audience: 'BOTH',
    title: 'The dispute has been resolved',
    body: 'A decision has been recorded on the dispute for this project.',
  },
  RESOLVE_DISPUTE_CLOSE: {
    type: 'DISPUTE_RESOLVED',
    audience: 'BOTH',
    title: 'The dispute has been resolved',
    body: 'A decision has been recorded on the dispute for this project.',
  },
};

const CONTRACT: EntityMap = {
  SEND: {
    type: 'CONTRACT_CREATED',
    audience: 'EXPERT',
    title: 'A contract is waiting for you',
    body: 'A contract has been sent to you. Read it in full before you accept.',
  },
  REQUEST_CHANGES: {
    type: 'CONTRACT_CREATED',
    audience: 'CUSTOMER',
    title: 'Changes were requested on the contract',
    body: 'The expert has asked for changes to the contract before accepting.',
  },
  RESEND: {
    type: 'CONTRACT_CREATED',
    audience: 'EXPERT',
    title: 'A revised contract is waiting for you',
    body: 'A revised contract has been sent to you. Read it in full before you accept.',
  },
  ACCEPT: {
    type: 'CONTRACT_CREATED',
    audience: 'CUSTOMER',
    title: 'The contract was accepted',
    body: 'Both sides have now accepted the contract.',
  },
  DECLINE: {
    type: 'CONTRACT_CREATED',
    audience: 'CUSTOMER',
    title: 'The contract was declined',
    body: 'The expert declined the contract.',
  },
  MARK_FUNDED: {
    type: 'MILESTONE_FUNDED',
    audience: 'EXPERT',
    title: 'The contract is funded',
    body: 'Funds for this contract are held in escrow. Work can begin.',
  },
  COMPLETE: {
    type: 'PROJECT_COMPLETED',
    audience: 'BOTH',
    title: 'The contract is complete',
    body: 'Every milestone on this contract has been approved.',
  },
  TERMINATE: {
    type: 'DISPUTE_RESOLVED',
    audience: 'BOTH',
    title: 'The contract was terminated',
    body: 'This contract has been terminated by the platform. Any held funds follow the escrow policy.',
  },
};

const MILESTONE: EntityMap = {
  OPEN_FOR_FUNDING: {
    type: 'MILESTONE_DUE',
    audience: 'CUSTOMER',
    title: 'A milestone is ready to fund',
    body: 'Fund this milestone to let work on it start. Funds are held in escrow until you approve the work.',
  },
  MARK_FUNDED: {
    type: 'MILESTONE_FUNDED',
    audience: 'EXPERT',
    title: 'A milestone has been funded',
    body: 'Funds for this milestone are held in escrow. You can start work.',
  },
  SUBMIT: {
    type: 'MILESTONE_SUBMITTED',
    audience: 'CUSTOMER',
    title: 'Work has been submitted for your review',
    body: 'The expert submitted a milestone. Review it and either approve it or request a revision.',
  },
  APPROVE: {
    type: 'MILESTONE_APPROVED',
    audience: 'EXPERT',
    title: 'Your milestone was approved',
    body: 'The customer approved this milestone.',
  },
  REQUEST_REVISION: {
    type: 'REVISION_REQUESTED',
    audience: 'EXPERT',
    title: 'A revision was requested',
    body: 'The customer asked for changes before approving this milestone.',
  },
  RAISE_DISPUTE: {
    type: 'DISPUTE_OPENED',
    audience: 'BOTH',
    title: 'A dispute was opened on a milestone',
    body: 'A dispute has been opened. The milestone is held while it is reviewed.',
  },
  RESOLVE_DISPUTE: {
    type: 'DISPUTE_RESOLVED',
    audience: 'BOTH',
    title: 'The milestone dispute was resolved',
    body: 'A decision has been recorded on this milestone.',
  },
};

const PAYMENT: EntityMap = {
  CONFIRM_SUCCEEDED: {
    type: 'PAYMENT_SUCCESSFUL',
    audience: 'CUSTOMER',
    title: 'Your payment succeeded',
    body: 'Your payment was received and is held in escrow.',
  },
  MARK_FAILED: {
    type: 'PAYMENT_SUCCESSFUL',
    audience: 'CUSTOMER',
    title: 'Your payment did not go through',
    body: 'The payment failed. Nothing was taken. You can try again.',
  },
  ALLOCATE_FUNDS: {
    type: 'MILESTONE_FUNDED',
    audience: 'EXPERT',
    title: 'Escrow is funded',
    body: 'Funds for this engagement are held in escrow.',
  },
  RELEASE: {
    type: 'PAYMENT_RELEASED',
    audience: 'BOTH',
    title: 'Escrow was released',
    body: "Funds held for this engagement have been released to the expert's balance.",
  },
  CONFIRM_REFUNDED: {
    type: 'PAYMENT_RELEASED',
    audience: 'CUSTOMER',
    title: 'Your refund was processed',
    body: 'A refund on this payment has been processed.',
  },
  CONFIRM_PARTIAL_REFUND: {
    type: 'PAYMENT_RELEASED',
    audience: 'CUSTOMER',
    title: 'A partial refund was processed',
    body: 'A partial refund on this payment has been processed.',
  },
  RECORD_CHARGEBACK: {
    type: 'DISPUTE_OPENED',
    audience: 'BOTH',
    title: 'A chargeback was recorded',
    body: 'The card issuer has raised a chargeback on this payment. It is under review.',
  },
};

const TABLE: Record<LifecycleEntity, EntityMap> = {
  Project: PROJECT,
  Contract: CONTRACT,
  Milestone: MILESTONE,
  Payment: PAYMENT,
};

/** The notification a transition produces, or null when it produces none. */
export function notificationFor(entityType: LifecycleEntity, event: string): LifecycleNotification | null {
  return TABLE[entityType][event] ?? null;
}

/** Resolve an audience to user ids, given who is on each side. */
export function recipientsFor(
  audience: Audience,
  participants: { readonly customerUserId: string | null; readonly expertUserIds: readonly string[] },
): readonly string[] {
  const recipients: string[] = [];
  if (audience !== 'EXPERT' && participants.customerUserId) recipients.push(participants.customerUserId);
  if (audience !== 'CUSTOMER') recipients.push(...participants.expertUserIds);
  // The same person can be on both sides of nothing, but a defensive de-dupe
  // costs nothing and stops a double notification if that ever changes.
  return [...new Set(recipients)];
}

/** Every event that notifies someone, for tests and for the admin view. */
export function mappedEvents(entityType: LifecycleEntity): readonly string[] {
  return Object.keys(TABLE[entityType]);
}

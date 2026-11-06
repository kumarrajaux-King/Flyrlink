/**
 * Who may read a conversation, and who may write into it.
 *
 * Pure, so every branch is unit-testable — the same reason STEP 02 §16 gives for
 * keeping permission logic out of I/O code. The decision itself is STEP 4's
 * `authorize()`, unchanged: this module only decides which permission is tried
 * and which resource context it is checked against.
 *
 * THE RULE THAT MATTERS
 *   Reading and posting are different authorities. `message:read:any` is
 *   oversight — ADMIN and SUPPORT hold it so they can investigate a dispute —
 *   and it grants reading only. It never grants posting, because a message in a
 *   project thread is attributable to a party to that engagement, and platform
 *   staff are not one. The single exception is a SUPPORT conversation, where
 *   answering is the whole point and `ticket:respond:any` says so explicitly.
 *
 * Membership, not the linked project, is the gate. A conversation's members are
 * materialised as rows (`conversation_members`), so access does not have to be
 * re-derived from the project graph on every read, and removing someone is one
 * write rather than a rule change.
 */

import { type Actor, type DenyReason, authorize } from '../../lib/authz/authorize';

export const CONVERSATION_TYPES = ['DIRECT', 'PROJECT', 'TEAM', 'SUPPORT'] as const;

export type ConversationType = (typeof CONVERSATION_TYPES)[number];

/**
 * What an access decision needs to know about a conversation.
 *
 * `memberUserIds` is the *active* membership. Someone who has left is listed in
 * `formerMemberUserIds` instead and is refused: an expert taken off an
 * engagement keeps no further sight of it, and the record stays available to the
 * remaining parties and to oversight. (Assumption A-13.)
 */
export interface ConversationSubject {
  readonly type: ConversationType;
  readonly isArchived: boolean;
  readonly memberUserIds: readonly string[];
  readonly formerMemberUserIds?: readonly string[] | undefined;
}

export type ConversationDenyReason =
  | DenyReason
  | 'MEMBERSHIP_ENDED'
  | 'CONVERSATION_ARCHIVED'
  | 'NOT_A_MEMBER';

export type ConversationAccess =
  | { readonly allowed: true; readonly basis: AccessBasis }
  | { readonly allowed: false; readonly reason: ConversationDenyReason };

/**
 * Why access was granted. Callers use it to decide whether the read needs an
 * audit record: a party reading their own thread does not, oversight does.
 */
export type AccessBasis = 'MEMBER' | 'OVERSIGHT' | 'SUPPORT_RESPONDER';

/** On refusal, report the most specific reason across the alternatives tried. */
const DENY_SPECIFICITY: Record<ConversationDenyReason, number> = {
  NOT_AUTHENTICATED: 8,
  ACCOUNT_INACTIVE: 7,
  MFA_REQUIRED: 6,
  SUPER_ADMIN_REQUIRED: 5,
  CONVERSATION_ARCHIVED: 4,
  MEMBERSHIP_ENDED: 3,
  NOT_A_MEMBER: 2,
  NOT_A_PARTICIPANT: 2,
  MISSING_PERMISSION: 1,
  RESOURCE_CONTEXT_REQUIRED: 0,
};

function moreSpecific(a: ConversationDenyReason, b: ConversationDenyReason): ConversationDenyReason {
  return DENY_SPECIFICITY[a] >= DENY_SPECIFICITY[b] ? a : b;
}

export function isActiveMember(actor: Actor, subject: ConversationSubject): boolean {
  return subject.memberUserIds.includes(actor.userId);
}

export function hasLeft(actor: Actor, subject: ConversationSubject): boolean {
  return subject.formerMemberUserIds?.includes(actor.userId) ?? false;
}

/**
 * Translate a membership miss into the reason that is actually true, so a
 * removed member is told their membership ended rather than that they were
 * never there.
 */
function membershipRefusal(actor: Actor, subject: ConversationSubject): ConversationDenyReason {
  return hasLeft(actor, subject) ? 'MEMBERSHIP_ENDED' : 'NOT_A_MEMBER';
}

/**
 * May this actor read the conversation and its messages?
 *
 * Tried in order of legitimacy: membership first, then oversight. Archiving does
 * not remove read access — an archived thread is closed to new messages, not
 * hidden from the people who were in it.
 */
export function canReadConversation(actor: Actor | null, subject: ConversationSubject): ConversationAccess {
  const asMember = authorize(actor, 'message:read:own', { participantUserIds: subject.memberUserIds });
  if (asMember.allowed) return { allowed: true, basis: 'MEMBER' };

  const asOversight = authorize(actor, 'message:read:any');
  if (asOversight.allowed) return { allowed: true, basis: 'OVERSIGHT' };

  // `NOT_A_PARTICIPANT` is the generic form; say which membership case it is.
  const memberReason: ConversationDenyReason =
    asMember.reason === 'NOT_A_PARTICIPANT' && actor ? membershipRefusal(actor, subject) : asMember.reason;

  return { allowed: false, reason: moreSpecific(memberReason, asOversight.reason) };
}

/**
 * May this actor post into the conversation?
 *
 * Authorization is decided before conversation state, so a stranger learns only
 * that they may not post — never whether the thread exists and is archived.
 */
export function canPostToConversation(actor: Actor | null, subject: ConversationSubject): ConversationAccess {
  const asMember = authorize(actor, 'message:create:own', { participantUserIds: subject.memberUserIds });

  // Platform staff answering a support thread. Deliberately narrow: it is the
  // only case in which a non-member may write, and only in a SUPPORT thread.
  const asResponder =
    subject.type === 'SUPPORT' ? authorize(actor, 'ticket:respond:any') : { allowed: false as const, reason: 'MISSING_PERMISSION' as const };

  if (!asMember.allowed && !asResponder.allowed) {
    const memberReason: ConversationDenyReason =
      asMember.reason === 'NOT_A_PARTICIPANT' && actor ? membershipRefusal(actor, subject) : asMember.reason;
    return { allowed: false, reason: moreSpecific(memberReason, asResponder.reason) };
  }

  // Authorized — now the conversation's own state applies, to everyone equally.
  if (subject.isArchived) return { allowed: false, reason: 'CONVERSATION_ARCHIVED' };

  return { allowed: true, basis: asMember.allowed ? 'MEMBER' : 'SUPPORT_RESPONDER' };
}

/** Human-readable refusal. Never states whether a record exists. */
export function conversationDenialMessage(reason: ConversationDenyReason): string {
  switch (reason) {
    case 'CONVERSATION_ARCHIVED':
      return 'This conversation is archived and accepts no new messages.';
    case 'MEMBERSHIP_ENDED':
      return 'You are no longer a member of this conversation.';
    case 'NOT_A_MEMBER':
    case 'NOT_A_PARTICIPANT':
      return 'You are not a member of this conversation.';
    case 'MFA_REQUIRED':
      return 'Complete multi-factor authentication to continue.';
    case 'ACCOUNT_INACTIVE':
      return 'This account is not active.';
    case 'SUPER_ADMIN_REQUIRED':
      return 'This action requires a super administrator.';
    case 'NOT_AUTHENTICATED':
      return 'You must be signed in.';
    default:
      return 'Your role does not permit this action.';
  }
}

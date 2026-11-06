/**
 * What may be done to a message once it has been sent.
 *
 * Pure rules, separated from the service so the boundaries are provable rather
 * than inspected: a message is evidence of what two parties agreed, and the
 * limits on rewriting it are part of the platform's integrity story, not a UI
 * nicety.
 *
 * THE THREE POSITIONS THIS FILE TAKES
 *   1. **Only the author edits, and only briefly.** A short window covers the
 *      typo; beyond it the thread is a record. Every edit stamps `editedAt`, so
 *      an edited message is always visibly edited.
 *   2. **Deletion is soft, and only the author's own.** The row stays, the body
 *      stops being served, and a tombstone remains in the thread — a message
 *      that silently vanishes lets one party rewrite the history the other
 *      remembers. Platform staff cannot delete at all: Phase 8 established that
 *      no admin code path deletes records, and moderation of correspondence is
 *      not among the 30 admin capabilities.
 *   3. **SYSTEM and AI_AGENT messages are immutable.** They are the machine's
 *      account of what happened. Nobody edits them, including their "author" —
 *      and an AI message is always labelled as one (blueprint rule 16), so it
 *      can never be edited into something that reads as human.
 */

export const MESSAGE_TYPES = ['USER', 'SYSTEM', 'AI_AGENT'] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Long enough for a considered reply, short enough that a thread stays readable. */
export const MESSAGE_MAX_LENGTH = 10_000;

/** The correction window. Past it, the thread is the record. */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Posting rate limit, per author per conversation.
 *
 * Not a security control — it is a guard against a runaway client or a loop
 * flooding a thread. The limit is generous enough that a fast human typist in an
 * argument never meets it.
 */
export const MESSAGE_RATE_LIMIT = { windowMs: 60_000, maxMessages: 30 } as const;

/** What the rules need to know about an existing message. */
export interface MessageSubject {
  readonly senderUserId: string | null;
  readonly type: MessageType;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

export type MessageMutationRefusal =
  | 'NOT_THE_AUTHOR'
  | 'NOT_A_USER_MESSAGE'
  | 'ALREADY_DELETED'
  | 'EDIT_WINDOW_EXPIRED';

/**
 * May `actorUserId` edit this message? Returns the refusal, or null to allow.
 *
 * Checked in order of permanence: authorship, then kind, then state, then time —
 * so someone who was never the author is not told about the window instead.
 */
export function editRefusal(
  actorUserId: string,
  message: MessageSubject,
  now: Date,
): MessageMutationRefusal | null {
  if (message.senderUserId === null || message.senderUserId !== actorUserId) return 'NOT_THE_AUTHOR';
  if (message.type !== 'USER') return 'NOT_A_USER_MESSAGE';
  if (message.deletedAt !== null) return 'ALREADY_DELETED';
  if (now.getTime() - message.createdAt.getTime() > MESSAGE_EDIT_WINDOW_MS) return 'EDIT_WINDOW_EXPIRED';
  return null;
}

/**
 * May `actorUserId` delete this message?
 *
 * No time limit: withdrawing something you said stays possible, because the
 * tombstone means withdrawal is visible rather than silent.
 */
export function deleteRefusal(actorUserId: string, message: MessageSubject): MessageMutationRefusal | null {
  if (message.senderUserId === null || message.senderUserId !== actorUserId) return 'NOT_THE_AUTHOR';
  if (message.type !== 'USER') return 'NOT_A_USER_MESSAGE';
  if (message.deletedAt !== null) return 'ALREADY_DELETED';
  return null;
}

export function mutationRefusalMessage(refusal: MessageMutationRefusal): string {
  switch (refusal) {
    case 'NOT_THE_AUTHOR':
      return 'Only the author of a message may change it.';
    case 'NOT_A_USER_MESSAGE':
      return 'System and AI messages cannot be edited or deleted.';
    case 'ALREADY_DELETED':
      return 'This message has already been deleted.';
    case 'EDIT_WINDOW_EXPIRED':
      return `A message can only be edited within ${MESSAGE_EDIT_WINDOW_MS / 60_000} minutes of sending.`;
  }
}

/** The body served in place of a deleted message. The thread keeps its shape. */
export const DELETED_MESSAGE_TOMBSTONE = '[message deleted]';

/**
 * What a reader is served for one message.
 *
 * A deleted message keeps its position, its author and its timestamp — only the
 * body goes. That is what makes deletion visible instead of silent.
 */
export function visibleBody(message: { readonly body: string; readonly deletedAt: Date | null }): string {
  return message.deletedAt === null ? message.body : DELETED_MESSAGE_TOMBSTONE;
}

/** True when the author has already sent as much as the window allows. */
export function exceedsRateLimit(recentMessageCount: number): boolean {
  return recentMessageCount >= MESSAGE_RATE_LIMIT.maxMessages;
}

/** The instant the rate-limit window starts, given "now". */
export function rateLimitWindowStart(now: Date): Date {
  return new Date(now.getTime() - MESSAGE_RATE_LIMIT.windowMs);
}

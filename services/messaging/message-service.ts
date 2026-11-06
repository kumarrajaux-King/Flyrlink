/**
 * Messages: posting, reading, correcting, withdrawing.
 *
 * WHAT POSTING ACTUALLY DOES
 *   One transaction writes the message, moves the thread's `lastMessageAt`, and
 *   records a notification for every other member. All three or none: a message
 *   that exists but notified nobody is a message the other party never learns
 *   about, and in an engagement where a milestone is waiting on an answer, that
 *   is a commercial failure, not a cosmetic one.
 *
 *   External delivery is deliberately not attempted inside that transaction —
 *   see `services/notification/notification-service.ts` for why.
 *
 * UNTRUSTED BY CONSTRUCTION
 *   A message body is text a user wrote. It is stored as text, returned as text,
 *   and never interpreted. It is never concatenated into an AI prompt by this
 *   service; when an agent is given conversation content, it arrives through the
 *   Phase 7 tool layer as data, inside the prompt-injection boundary STEP 02 §22
 *   sets out. Nothing in this file renders HTML or evaluates anything.
 *
 * WHO CAN SEE WHAT
 *   Reading a thread is decided by `canReadConversation`; posting by
 *   `canPostToConversation`. An oversight reader (ADMIN, SUPPORT) can read and
 *   cannot post, and their read is audited — reading two parties' private
 *   correspondence is a privileged act and leaves a trace naming who did it.
 */

import {
  canPostToConversation,
  conversationDenialMessage,
} from '../../domain/messaging/conversation-access';
import {
  MESSAGE_MAX_LENGTH,
  type MessageType,
  deleteRefusal,
  editRefusal,
  exceedsRateLimit,
  mutationRefusalMessage,
  rateLimitWindowStart,
  visibleBody,
} from '../../domain/messaging/message-rules';
import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, type PrismaTransaction } from '../../lib/db/client';
import { type Page, type PageRequest, iso, newestFirst, pageSize, toPage } from '../../lib/pagination';
import { notifyMany } from '../notification/notification-service';
import { linkAttachments } from './attachment-service';
import { MessagingRejection, loadReadable, notFound, subjectOf } from './conversation-service';
import { inTransaction } from './transaction';

export interface MessageView {
  readonly id: string;
  readonly conversationId: string;
  readonly senderUserId: string | null;
  readonly senderName: string | null;
  /** USER, SYSTEM or AI_AGENT. An AI message is always labelled as one. */
  readonly type: string;
  readonly body: string;
  readonly parentMessageId: string | null;
  readonly aiRunId: string | null;
  readonly isDeleted: boolean;
  readonly editedAt: string | null;
  readonly createdAt: string;
  readonly attachments: readonly MessageAttachmentView[];
}

export interface MessageAttachmentView {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderUserId: true,
  type: true,
  body: true,
  parentMessageId: true,
  aiRunId: true,
  editedAt: true,
  createdAt: true,
  deletedAt: true,
  sender: { select: { fullName: true, deletedAt: true } },
  attachments: {
    where: { deletedAt: null },
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
  },
} as const;

type MessageRow = {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  type: string;
  body: string;
  parentMessageId: string | null;
  aiRunId: string | null;
  editedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  sender: { fullName: string; deletedAt: Date | null } | null;
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
};

function view(row: MessageRow): MessageView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderUserId: row.senderUserId,
    // A closed account keeps its messages in the thread but stops being named.
    senderName: row.sender && row.sender.deletedAt === null ? row.sender.fullName : null,
    type: row.type,
    body: visibleBody(row),
    parentMessageId: row.parentMessageId,
    aiRunId: row.aiRunId,
    isDeleted: row.deletedAt !== null,
    editedAt: iso(row.editedAt),
    createdAt: row.createdAt.toISOString(),
    // A withdrawn message takes its attachments with it.
    attachments: row.deletedAt === null ? row.attachments : [],
  };
}

export interface PostMessageInput {
  readonly conversationId: string;
  readonly body: string;
  readonly parentMessageId?: string | undefined;
  /** Attachments already uploaded and confirmed by this caller. */
  readonly attachmentIds?: readonly string[] | undefined;
}

/**
 * Post a message as the acting human.
 *
 * `type` is always USER here. SYSTEM and AI_AGENT messages have their own entry
 * points below and are not reachable from a request, for the same reason the
 * lifecycle routes only ever build a HUMAN actor: an actor kind that a client
 * can choose is an actor kind a client can forge.
 */
export async function postMessage(
  db: Db,
  actor: Actor,
  input: PostMessageInput,
  context: RequestContext = {},
): Promise<MessageView> {
  const body = input.body.trim();
  const attachmentIds = input.attachmentIds ?? [];
  // A message with a file and no words is legitimate; one with neither is not.
  if (body.length === 0 && attachmentIds.length === 0) {
    throw new MessagingRejection('FORBIDDEN', 'A message cannot be empty.');
  }
  if (body.length > MESSAGE_MAX_LENGTH) {
    throw new MessagingRejection('FORBIDDEN', `A message can be at most ${MESSAGE_MAX_LENGTH} characters.`);
  }

  const { row: conversation } = await loadReadable(db, actor, input.conversationId);

  const decision = canPostToConversation(actor, subjectOf(conversation));
  if (!decision.allowed) {
    throw new MessagingRejection(
      decision.reason === 'CONVERSATION_ARCHIVED' ? 'CONVERSATION_ARCHIVED' : 'FORBIDDEN',
      conversationDenialMessage(decision.reason),
    );
  }

  const now = new Date();
  const recent = await db.message.count({
    where: {
      conversationId: input.conversationId,
      senderUserId: actor.userId,
      createdAt: { gte: rateLimitWindowStart(now) },
    },
  });
  if (exceedsRateLimit(recent)) {
    throw new MessagingRejection('RATE_LIMITED', 'You are sending messages too quickly. Try again shortly.');
  }

  // A reply must belong to the same thread; otherwise a parent id is a way to
  // point at a message in a conversation you cannot see.
  if (input.parentMessageId) {
    const parent = await db.message.findFirst({
      where: { id: input.parentMessageId, conversationId: input.conversationId },
      select: { id: true },
    });
    if (!parent) throw notFound('parent message');
  }

  const messageId = await writeMessage(db, {
    conversationId: input.conversationId,
    senderUserId: actor.userId,
    type: 'USER',
    body,
    parentMessageId: input.parentMessageId ?? null,
    aiRunId: null,
    actingUserId: actor.userId,
    senderLabel: null,
    // Linked inside the same transaction: a message that mentions a file the
    // reader cannot open is worse than no message at all.
    link: (tx, id) => linkAttachments(tx, actor, id, attachmentIds),
    context,
  });

  const row = await db.message.findUniqueOrThrow({ where: { id: messageId }, select: MESSAGE_SELECT });
  return view(row);
}

/**
 * Record a SYSTEM message in a thread — "the milestone was approved".
 *
 * Server-side callers only. There is no route to it.
 */
export async function postSystemMessage(
  db: Db,
  input: { readonly conversationId: string; readonly body: string },
): Promise<string> {
  return writeMessage(db, {
    conversationId: input.conversationId,
    senderUserId: null,
    type: 'SYSTEM',
    body: input.body.slice(0, MESSAGE_MAX_LENGTH),
    parentMessageId: null,
    aiRunId: null,
    actingUserId: null,
    senderLabel: 'the platform',
    context: {},
  });
}

/**
 * Record an AI_AGENT message, always attributed to the run that produced it.
 *
 * `aiRunId` is required, not optional. An AI message with no traceable run is a
 * message nobody can audit, and blueprint rule 16 — an agent never passes as a
 * person — depends on the label and the trail both being there.
 */
export async function postAgentMessage(
  db: Db,
  input: { readonly conversationId: string; readonly body: string; readonly aiRunId: string },
): Promise<string> {
  return writeMessage(db, {
    conversationId: input.conversationId,
    senderUserId: null,
    type: 'AI_AGENT',
    body: input.body.slice(0, MESSAGE_MAX_LENGTH),
    parentMessageId: null,
    aiRunId: input.aiRunId,
    actingUserId: null,
    senderLabel: 'an AI assistant',
    context: {},
  });
}

interface WriteMessageInput {
  readonly conversationId: string;
  readonly senderUserId: string | null;
  readonly type: MessageType;
  readonly body: string;
  readonly parentMessageId: string | null;
  readonly aiRunId: string | null;
  /** Whom not to notify: the person who wrote it. */
  readonly actingUserId: string | null;
  /** How a non-human sender is described in the notification. */
  readonly senderLabel: string | null;
  /** Extra work that must commit with the message, such as linking files. */
  readonly link?: ((tx: PrismaTransaction, messageId: string) => Promise<unknown>) | undefined;
  readonly context: RequestContext;
}

/** The write, the thread bump and the notifications, in one transaction. */
async function writeMessage(db: Db, input: WriteMessageInput): Promise<string> {
  const run = async (tx: PrismaTransaction): Promise<string> => {
    const created = await tx.message.create({
      data: {
        conversationId: input.conversationId,
        senderUserId: input.senderUserId,
        type: input.type,
        body: input.body,
        parentMessageId: input.parentMessageId,
        aiRunId: input.aiRunId,
      },
      select: { id: true, createdAt: true },
    });

    if (input.link) await input.link(tx, created.id);

    await tx.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: created.createdAt },
    });

    const members = await tx.conversationMember.findMany({
      where: { conversationId: input.conversationId, leftAt: null },
      select: { userId: true, isMuted: true },
    });

    const senderName = input.senderUserId
      ? (
          await tx.user.findUnique({
            where: { id: input.senderUserId },
            select: { fullName: true },
          })
        )?.fullName ?? 'Someone'
      : (input.senderLabel ?? 'the platform');

    await notifyMany(
      tx,
      members
        .filter((member) => member.userId !== input.actingUserId)
        .map((member) => ({
          userId: member.userId,
          type: 'MESSAGE_RECEIVED' as const,
          title: `New message from ${senderName}`,
          // The preview is deliberately absent. A notification can travel to a
          // phone's lock screen or an inbox; the contents of a private thread
          // should not follow it there.
          body: 'You have a new message in a conversation you are part of.',
          entityType: 'Conversation',
          entityId: input.conversationId,
          actionUrl: `/messages/${input.conversationId}`,
          routing: { conversationMuted: member.isMuted },
        })),
    );

    return created.id;
  };

  return inTransaction(db, run);
}

export type MessageQuery = PageRequest;

/**
 * A page of a thread, newest first.
 *
 * An oversight read is audited here rather than at the route, so it is recorded
 * however the service is reached.
 */
export async function listMessages(
  db: Db,
  actor: Actor,
  conversationId: string,
  query: MessageQuery = {},
  context: RequestContext = {},
): Promise<Page<MessageView>> {
  const { basis } = await loadReadable(db, actor, conversationId);

  const size = pageSize(query.limit);
  const rows = await db.message.findMany({
    where: { conversationId, ...newestFirst(query.cursor) },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: MESSAGE_SELECT,
  });

  if (basis === 'OVERSIGHT') {
    await writeAudit(db, {
      action: AUDIT_ACTIONS.CONVERSATION_READ_BY_OVERSIGHT,
      entityType: 'Conversation',
      entityId: conversationId,
      actorUserId: actor.userId,
      severity: 'NOTICE',
      afterState: { messagesReturned: Math.min(rows.length, size) },
      ...context,
    });
  }

  return toPage(rows, size, view);
}

/** Correct your own message, inside the edit window. */
export async function editMessage(
  db: Db,
  actor: Actor,
  messageId: string,
  body: string,
  context: RequestContext = {},
): Promise<MessageView> {
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > MESSAGE_MAX_LENGTH) {
    throw new MessagingRejection('FORBIDDEN', `A message must be between 1 and ${MESSAGE_MAX_LENGTH} characters.`);
  }

  const existing = await db.message.findUnique({
    where: { id: messageId },
    select: { id: true, conversationId: true, senderUserId: true, type: true, createdAt: true, deletedAt: true, body: true },
  });
  if (!existing) throw notFound('message');

  // Thread access first: the refusal a non-member gets must not depend on
  // whether the message they guessed at is editable.
  await loadReadable(db, actor, existing.conversationId);

  const refusal = editRefusal(actor.userId, { ...existing, type: existing.type as MessageType }, new Date());
  if (refusal) throw new MessagingRejection('MESSAGE_IMMUTABLE', mutationRefusalMessage(refusal));

  await db.message.update({ where: { id: messageId }, data: { body: trimmed, editedAt: new Date() } });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.MESSAGE_EDITED,
    entityType: 'Message',
    entityId: messageId,
    actorUserId: actor.userId,
    // The prior text is kept: an edit must not be able to erase what was said.
    beforeState: { body: existing.body },
    afterState: { body: trimmed, conversationId: existing.conversationId },
    ...context,
  });

  const row = await db.message.findUniqueOrThrow({ where: { id: messageId }, select: MESSAGE_SELECT });
  return view(row);
}

/** Withdraw your own message. Soft: the tombstone stays in the thread. */
export async function deleteMessage(
  db: Db,
  actor: Actor,
  messageId: string,
  context: RequestContext = {},
): Promise<MessageView> {
  const existing = await db.message.findUnique({
    where: { id: messageId },
    select: { id: true, conversationId: true, senderUserId: true, type: true, createdAt: true, deletedAt: true, body: true },
  });
  if (!existing) throw notFound('message');

  await loadReadable(db, actor, existing.conversationId);

  const refusal = deleteRefusal(actor.userId, { ...existing, type: existing.type as MessageType });
  if (refusal) throw new MessagingRejection('MESSAGE_IMMUTABLE', mutationRefusalMessage(refusal));

  const now = new Date();
  await inTransaction(db, async (tx) => {
    await tx.message.update({ where: { id: messageId }, data: { deletedAt: now } });
    // Attachments go with the message they were sent on.
    await tx.attachment.updateMany({ where: { messageId, deletedAt: null }, data: { deletedAt: now } });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.MESSAGE_DELETED,
      entityType: 'Message',
      entityId: messageId,
      actorUserId: actor.userId,
      beforeState: { body: existing.body },
      afterState: { conversationId: existing.conversationId },
      ...context,
    });
  });

  const row = await db.message.findUniqueOrThrow({ where: { id: messageId }, select: MESSAGE_SELECT });
  return view(row);
}

/** Total unread messages across every thread the caller is in. */
export async function totalUnreadMessages(db: Db, actor: Actor): Promise<number> {
  const memberships = await db.conversationMember.findMany({
    where: { userId: actor.userId, leftAt: null, conversation: { isArchived: false } },
    select: { conversationId: true, lastReadAt: true },
  });

  let total = 0;
  for (const membership of memberships) {
    total += await db.message.count({
      where: {
        conversationId: membership.conversationId,
        senderUserId: { not: actor.userId },
        deletedAt: null,
        ...(membership.lastReadAt ? { createdAt: { gt: membership.lastReadAt } } : {}),
      },
    });
  }
  return total;
}

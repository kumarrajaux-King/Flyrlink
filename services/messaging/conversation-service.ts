/**
 * Conversations: opening them, listing them, and changing who is in them.
 *
 * ONE THREAD PER THING
 *   A project has one conversation, a contract has one, a team has one. Threads
 *   are opened on demand and reused — `ensureProjectConversation` is idempotent,
 *   so two people opening the messages tab at the same moment do not create two
 *   threads. The uniqueness is enforced by taking the row lock on the parent
 *   record, not by a unique index, because `conversations.projectId` is
 *   deliberately nullable (a DIRECT thread has no parent).
 *
 * WHO MAY OPEN ONE
 *   Only someone who would be a member of it. The derivation in
 *   `participants.ts` decides that from the engagement, and a caller who is not
 *   among the derived parties is refused — so "open the thread for project X" is
 *   not a way to discover that project X exists.
 *
 * DIRECT THREADS ARE NOT OPEN DMs
 *   A marketplace where any user can message any other is a marketplace with a
 *   spam problem and a disintermediation problem. A DIRECT thread may only be
 *   opened between two people who already share an engagement. There is no
 *   "message this expert" path that bypasses a project. (Assumption A-14.)
 */

import {
  type ConversationSubject,
  type ConversationType,
  canReadConversation,
  conversationDenialMessage,
} from '../../domain/messaging/conversation-access';
import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, type PrismaTransaction } from '../../lib/db/client';
import { type Page, type PageRequest, iso, pageSize, toPage } from '../../lib/pagination';
import { allParties, contractParties, projectParties, shareAnEngagement, teamParties } from './participants';
import { inTransaction } from './transaction';

/** A refusal the caller is allowed to see. Mapped to HTTP by the route layer. */
export class MessagingRejection extends Error {
  readonly code: MessagingRejectionCode;

  constructor(code: MessagingRejectionCode, message: string) {
    super(message);
    this.name = 'MessagingRejection';
    this.code = code;
  }
}

export type MessagingRejectionCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONVERSATION_ARCHIVED'
  | 'NO_SHARED_ENGAGEMENT'
  | 'NOT_A_MEMBER'
  | 'RATE_LIMITED'
  | 'MESSAGE_IMMUTABLE'
  | 'ATTACHMENT_REJECTED'
  | 'UPLOAD_INCOMPLETE';

export function notFound(what: string): MessagingRejection {
  return new MessagingRejection('NOT_FOUND', `No ${what} with that id.`);
}

export interface ConversationView {
  readonly id: string;
  readonly type: string;
  readonly title: string | null;
  readonly projectId: string | null;
  readonly contractId: string | null;
  readonly teamId: string | null;
  readonly isArchived: boolean;
  readonly isMuted: boolean;
  readonly lastMessageAt: string | null;
  readonly unreadCount: number;
  readonly memberUserIds: readonly string[];
}

const MEMBER_SELECT = {
  select: { userId: true, leftAt: true, lastReadAt: true, isMuted: true },
} as const;

const CONVERSATION_SELECT = {
  id: true,
  type: true,
  title: true,
  projectId: true,
  contractId: true,
  teamId: true,
  isArchived: true,
  lastMessageAt: true,
  members: MEMBER_SELECT,
} as const;

type ConversationRow = {
  id: string;
  type: string;
  title: string | null;
  projectId: string | null;
  contractId: string | null;
  teamId: string | null;
  isArchived: boolean;
  lastMessageAt: Date | null;
  members: { userId: string; leftAt: Date | null; lastReadAt: Date | null; isMuted: boolean }[];
};

/** The access-decision shape, built from a loaded row. */
export function subjectOf(row: ConversationRow): ConversationSubject {
  return {
    type: row.type as ConversationType,
    isArchived: row.isArchived,
    memberUserIds: row.members.filter((member) => member.leftAt === null).map((member) => member.userId),
    formerMemberUserIds: row.members.filter((member) => member.leftAt !== null).map((member) => member.userId),
  };
}

/**
 * Load a conversation the actor may read, or refuse.
 *
 * Every read path goes through here, so there is no code path that loads a
 * conversation by id alone — the rule STEP 02 §8 states for every resource.
 */
export async function loadReadable(
  db: Db,
  actor: Actor,
  conversationId: string,
): Promise<{ row: ConversationRow; basis: 'MEMBER' | 'OVERSIGHT' }> {
  const row = await db.conversation.findUnique({
    where: { id: conversationId },
    select: CONVERSATION_SELECT,
  });
  if (!row) throw notFound('conversation');

  const decision = canReadConversation(actor, subjectOf(row));
  if (!decision.allowed) {
    throw new MessagingRejection('FORBIDDEN', conversationDenialMessage(decision.reason));
  }

  // `canReadConversation` grants on membership or oversight only; the support
  // responder basis is a posting concession, never a reading one.
  return { row, basis: decision.basis === 'OVERSIGHT' ? 'OVERSIGHT' : 'MEMBER' };
}

async function unreadCountFor(db: Db, conversationId: string, member: { lastReadAt: Date | null; userId: string }): Promise<number> {
  return db.message.count({
    where: {
      conversationId,
      // Your own messages are never unread, and a deleted one is not news.
      senderUserId: { not: member.userId },
      deletedAt: null,
      ...(member.lastReadAt ? { createdAt: { gt: member.lastReadAt } } : {}),
    },
  });
}

async function toView(db: Db, row: ConversationRow, actor: Actor): Promise<ConversationView> {
  const membership = row.members.find((member) => member.userId === actor.userId && member.leftAt === null);
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    projectId: row.projectId,
    contractId: row.contractId,
    teamId: row.teamId,
    isArchived: row.isArchived,
    isMuted: membership?.isMuted ?? false,
    lastMessageAt: iso(row.lastMessageAt),
    unreadCount: membership ? await unreadCountFor(db, row.id, { ...membership, userId: actor.userId }) : 0,
    memberUserIds: subjectOf(row).memberUserIds,
  };
}

/**
 * Open (or reuse) the conversation for an engagement.
 *
 * The parent row is locked first, so concurrent callers serialise and exactly
 * one thread is created.
 */
async function ensureConversation(
  db: Db,
  actor: Actor,
  scope: {
    readonly type: ConversationType;
    readonly column: 'projectId' | 'contractId' | 'teamId';
    readonly parentId: string;
    readonly table: 'projects' | 'contracts' | 'teams';
    readonly parties: (tx: PrismaTransaction, id: string) => Promise<{ customerUserId: string | null; expertUserIds: readonly string[] }>;
    readonly title: string | null;
  },
  context: RequestContext,
): Promise<ConversationView> {
  const run = async (tx: PrismaTransaction): Promise<string> => {
    // Serialise thread creation on the parent record.
    const locked = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM ${scope.table} WHERE id = $1::uuid FOR UPDATE`,
      scope.parentId,
    );
    if (locked.length === 0) throw notFound(scope.table.replace(/s$/, ''));

    const parties = await scope.parties(tx, scope.parentId);
    const members = allParties(parties);

    // Authorization for *opening* a thread: you must be one of its parties.
    // Oversight roles do not open threads; they read ones that exist.
    if (!members.includes(actor.userId)) {
      throw new MessagingRejection('FORBIDDEN', 'You are not a party to this engagement.');
    }

    const existing = await tx.conversation.findFirst({
      where: { [scope.column]: scope.parentId, type: scope.type },
      select: { id: true },
    });

    const conversationId =
      existing?.id ??
      (
        await tx.conversation.create({
          data: { type: scope.type, [scope.column]: scope.parentId, title: scope.title },
          select: { id: true },
        })
      ).id;

    await addMissingMembers(tx, conversationId, members);

    if (!existing) {
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.CONVERSATION_OPENED,
        entityType: 'Conversation',
        entityId: conversationId,
        actorUserId: actor.userId,
        afterState: { type: scope.type, [scope.column]: scope.parentId, memberCount: members.length },
        ...context,
      });
    }

    return conversationId;
  };

  const conversationId = await inTransaction(db, run);

  const row = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: CONVERSATION_SELECT,
  });
  return toView(db, row, actor);
}

/**
 * Add anyone missing, and reinstate anyone who had left but is a party again.
 *
 * Reinstating rather than inserting keeps one row per person per thread, which
 * is what the unique constraint expects and what makes `lastReadAt` survive a
 * round trip off and back onto an engagement.
 */
async function addMissingMembers(tx: PrismaTransaction, conversationId: string, userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;

  const existing = await tx.conversationMember.findMany({
    where: { conversationId, userId: { in: [...userIds] } },
    select: { userId: true, leftAt: true },
  });
  const byUser = new Map(existing.map((member) => [member.userId, member]));

  for (const userId of userIds) {
    const member = byUser.get(userId);
    if (!member) {
      await tx.conversationMember.create({ data: { conversationId, userId } });
    } else if (member.leftAt !== null) {
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId } },
        data: { leftAt: null },
      });
    }
  }
}

export async function ensureProjectConversation(
  db: Db,
  actor: Actor,
  projectId: string,
  context: RequestContext = {},
): Promise<ConversationView> {
  return ensureConversation(
    db,
    actor,
    {
      type: 'PROJECT',
      column: 'projectId',
      parentId: projectId,
      table: 'projects',
      parties: projectParties,
      title: null,
    },
    context,
  );
}

/**
 * The thread scoped to one contract.
 *
 * `ConversationType` has no `CONTRACT` member — STEP 3 gave `Conversation` a
 * `contractId` column but typed contract threads as `PROJECT`, because they are
 * project-context threads narrowed to one agreement. The column is what makes
 * them distinct, and it is indexed for exactly that. Noted rather than changed:
 * adding an enum value is a migration, and nothing here needs one.
 */
export async function ensureContractConversation(
  db: Db,
  actor: Actor,
  contractId: string,
  context: RequestContext = {},
): Promise<ConversationView> {
  return ensureConversation(
    db,
    actor,
    {
      type: 'PROJECT',
      column: 'contractId',
      parentId: contractId,
      table: 'contracts',
      parties: contractParties,
      title: null,
    },
    context,
  );
}

export async function ensureTeamConversation(
  db: Db,
  actor: Actor,
  teamId: string,
  context: RequestContext = {},
): Promise<ConversationView> {
  return ensureConversation(
    db,
    actor,
    { type: 'TEAM', column: 'teamId', parentId: teamId, table: 'teams', parties: teamParties, title: null },
    context,
  );
}

/**
 * Open (or reuse) a one-to-one thread with someone you already work with.
 *
 * The shared-engagement check is the anti-spam control and the
 * anti-disintermediation control at once: you can only start a private thread
 * with a counterparty the platform already put you with.
 */
export async function ensureDirectConversation(
  db: Db,
  actor: Actor,
  otherUserId: string,
  context: RequestContext = {},
): Promise<ConversationView> {
  if (otherUserId === actor.userId) {
    throw new MessagingRejection('NO_SHARED_ENGAGEMENT', 'You cannot open a conversation with yourself.');
  }

  const other = await db.user.findFirst({ where: { id: otherUserId, deletedAt: null }, select: { id: true } });
  // Deliberately the same refusal as "we share nothing": whether an account
  // exists is not something an arbitrary user gets to probe.
  if (!other || !(await shareAnEngagement(db, actor.userId, otherUserId))) {
    throw new MessagingRejection(
      'NO_SHARED_ENGAGEMENT',
      'You can only message someone you share a project or contract with.',
    );
  }

  const run = async (tx: PrismaTransaction): Promise<string> => {
    const existing = await tx.conversation.findFirst({
      where: {
        type: 'DIRECT',
        projectId: null,
        contractId: null,
        teamId: null,
        AND: [
          { members: { some: { userId: actor.userId, leftAt: null } } },
          { members: { some: { userId: otherUserId, leftAt: null } } },
        ],
      },
      select: { id: true, members: { select: { userId: true, leftAt: true } } },
    });

    // `some`/`some` matches a thread that contains both — a two-member thread is
    // the only DIRECT shape, but check the size so a future group thread is not
    // silently reused as a private one.
    const reusable = existing && existing.members.filter((member) => member.leftAt === null).length === 2;
    if (reusable) return existing.id;

    const created = await tx.conversation.create({ data: { type: 'DIRECT' }, select: { id: true } });
    await addMissingMembers(tx, created.id, [actor.userId, otherUserId]);

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.CONVERSATION_OPENED,
      entityType: 'Conversation',
      entityId: created.id,
      actorUserId: actor.userId,
      afterState: { type: 'DIRECT', withUserId: otherUserId },
      ...context,
    });

    return created.id;
  };

  const conversationId = await inTransaction(db, run);
  const row = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: CONVERSATION_SELECT });
  return toView(db, row, actor);
}

export interface ConversationQuery extends PageRequest {
  readonly includeArchived?: boolean | undefined;
}

/**
 * The caller's inbox, most recently active first.
 *
 * Ordered by `lastMessageAt` rather than by id: an inbox is about what is
 * happening now, not about when a thread was opened. The cursor is still the id,
 * which means a page boundary is stable even though the order is not — a thread
 * that gets a new message while you are paging moves to the top of page one
 * rather than appearing twice further down.
 */
export async function listConversations(
  db: Db,
  actor: Actor,
  query: ConversationQuery = {},
): Promise<Page<ConversationView>> {
  const size = pageSize(query.limit);

  const cursorRow = query.cursor
    ? await db.conversation.findUnique({
        where: { id: query.cursor },
        select: { id: true, lastMessageAt: true },
      })
    : null;

  // Keyset condition for `ORDER BY lastMessageAt DESC NULLS LAST, id DESC`:
  // strictly older activity, or the same activity further down the id order.
  // A thread that has never been used sorts last, so paging from one can only
  // reach other never-used threads.
  const afterCursor = cursorRow
    ? cursorRow.lastMessageAt === null
      ? { lastMessageAt: null, id: { lt: cursorRow.id } }
      : {
          OR: [
            { lastMessageAt: { lt: cursorRow.lastMessageAt } },
            { lastMessageAt: cursorRow.lastMessageAt, id: { lt: cursorRow.id } },
            { lastMessageAt: null },
          ],
        }
    : {};

  const rows = await db.conversation.findMany({
    where: {
      members: { some: { userId: actor.userId, leftAt: null } },
      ...(query.includeArchived === true ? {} : { isArchived: false }),
      ...afterCursor,
    },
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take: size + 1,
    select: CONVERSATION_SELECT,
  });

  const page = toPage(rows, size, (row) => row);
  const items = await Promise.all(page.items.map((row) => toView(db, row, actor)));
  return { items, nextCursor: page.nextCursor };
}

/** One conversation, if the caller may read it. */
export async function getConversation(db: Db, actor: Actor, conversationId: string): Promise<ConversationView> {
  const { row } = await loadReadable(db, actor, conversationId);
  return toView(db, row, actor);
}

/** Mark everything up to now as read for the caller. */
export async function markConversationRead(db: Db, actor: Actor, conversationId: string): Promise<{ readAt: string }> {
  await loadReadable(db, actor, conversationId);
  const readAt = new Date();
  const result = await db.conversationMember.updateMany({
    where: { conversationId, userId: actor.userId, leftAt: null },
    data: { lastReadAt: readAt },
  });
  if (result.count === 0) {
    throw new MessagingRejection('NOT_A_MEMBER', 'Only a member of a conversation can mark it read.');
  }
  return { readAt: readAt.toISOString() };
}

/** Mute or unmute the thread for the caller only. */
export async function setConversationMuted(
  db: Db,
  actor: Actor,
  conversationId: string,
  isMuted: boolean,
): Promise<{ isMuted: boolean }> {
  await loadReadable(db, actor, conversationId);
  const result = await db.conversationMember.updateMany({
    where: { conversationId, userId: actor.userId, leftAt: null },
    data: { isMuted },
  });
  if (result.count === 0) {
    throw new MessagingRejection('NOT_A_MEMBER', 'Only a member of a conversation can mute it.');
  }
  return { isMuted };
}

/**
 * Archive or reopen a thread. Archiving is for everyone in it, not just the
 * caller — it closes the thread to new messages, which is a property of the
 * thread, not a per-person view. Any member may do it; any member may undo it.
 */
export async function setConversationArchived(
  db: Db,
  actor: Actor,
  conversationId: string,
  isArchived: boolean,
  context: RequestContext = {},
): Promise<ConversationView> {
  const { row } = await loadReadable(db, actor, conversationId);
  if (!subjectOf(row).memberUserIds.includes(actor.userId)) {
    throw new MessagingRejection('NOT_A_MEMBER', 'Only a member of a conversation can archive it.');
  }

  if (row.isArchived !== isArchived) {
    await db.conversation.update({ where: { id: conversationId }, data: { isArchived } });
    await writeAudit(db, {
      action: AUDIT_ACTIONS.CONVERSATION_ARCHIVED,
      entityType: 'Conversation',
      entityId: conversationId,
      actorUserId: actor.userId,
      beforeState: { isArchived: row.isArchived },
      afterState: { isArchived },
      ...context,
    });
  }

  const updated = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: CONVERSATION_SELECT });
  return toView(db, updated, actor);
}

/**
 * Leave a conversation.
 *
 * Only ever yourself: there is no "remove that person" call, because taking
 * someone off a thread is a consequence of taking them off the engagement, and
 * that decision belongs to the lifecycle, not to whoever is reading the thread.
 */
export async function leaveConversation(
  db: Db,
  actor: Actor,
  conversationId: string,
  context: RequestContext = {},
): Promise<void> {
  const { row } = await loadReadable(db, actor, conversationId);
  if (!subjectOf(row).memberUserIds.includes(actor.userId)) {
    throw new MessagingRejection('NOT_A_MEMBER', 'You are not a member of this conversation.');
  }

  await db.conversationMember.updateMany({
    where: { conversationId, userId: actor.userId, leftAt: null },
    data: { leftAt: new Date() },
  });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.CONVERSATION_MEMBER_LEFT,
    entityType: 'Conversation',
    entityId: conversationId,
    actorUserId: actor.userId,
    afterState: { userId: actor.userId },
    ...context,
  });
}

/**
 * Bring a thread's membership back in line with its engagement.
 *
 * Called after a lifecycle change adds a party — an expert accepts an
 * assignment, a team gains a member. Additive by design (see the module note).
 */
export async function syncEngagementMembers(db: Db, conversationId: string): Promise<number> {
  const row = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, projectId: true, contractId: true, teamId: true },
  });
  if (!row) return 0;

  const parties = row.projectId
    ? await projectParties(db, row.projectId)
    : row.contractId
      ? await contractParties(db, row.contractId)
      : row.teamId
        ? await teamParties(db, row.teamId)
        : null;
  if (!parties) return 0;

  const members = allParties(parties);
  const before = await db.conversationMember.count({ where: { conversationId, leftAt: null } });
  await addMissingMembers(db as PrismaTransaction, conversationId, members);
  const after = await db.conversationMember.count({ where: { conversationId, leftAt: null } });
  return after - before;
}

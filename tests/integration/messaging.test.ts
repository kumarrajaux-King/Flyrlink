/**
 * Messaging, attachments and notifications — Phase 9 integration tests.
 *
 * Everything here runs against real PostgreSQL through the services, because
 * the properties that matter are transactional ones that a mock cannot show:
 * that a message and its notifications commit together, that an unconfirmed
 * upload can never reach a thread, that a lifecycle transition notifies the
 * other party and not the one who caused it.
 *
 * Skips cleanly when no database is reachable.
 */

import { rm } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MESSAGE_RATE_LIMIT } from '../../domain/messaging/message-rules';
import type { NotificationType } from '../../domain/notification/routing';
import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import { prisma } from '../../lib/db/client';
import { LocalFilesystemStorage, setStorageProvider } from '../../lib/storage/provider';
import {
  confirmUpload,
  getAttachmentDownload,
  reserveUpload,
} from '../../services/messaging/attachment-service';
import {
  MessagingRejection,
  ensureDirectConversation,
  ensureProjectConversation,
  getConversation,
  leaveConversation,
  listConversations,
  markConversationRead,
  setConversationArchived,
  setConversationMuted,
} from '../../services/messaging/conversation-service';
import {
  deleteMessage,
  editMessage,
  listMessages,
  postAgentMessage,
  postMessage,
  postSystemMessage,
  totalUnreadMessages,
} from '../../services/messaging/message-service';
import {
  dispatchPending,
  listNotifications,
  listPreferences,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
  updatePreference,
} from '../../services/notification/notification-service';
import { transitionMilestone } from '../../services/lifecycle';
import {
  type LifecycleWorld,
  createLifecycleWorld,
  isDatabaseAvailable,
} from '../support/lifecycle-fixtures';

const available = await isDatabaseAvailable();

let world!: LifecycleWorld;
const storageRoot = `.storage-test-${Date.now().toString(36)}`;
const storage = new LocalFilesystemStorage(storageRoot);

/** Assert a service call is refused with a specific code. */
async function rejects(work: Promise<unknown>, code: string): Promise<MessagingRejection> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(MessagingRejection);
    expect((error as MessagingRejection).code).toBe(code);
    return error as MessagingRejection;
  }
  throw new Error(`Expected a ${code} rejection, but the call succeeded.`);
}

/** In-app notifications a user holds of one type. */
async function notificationsOf(userId: string, type: NotificationType) {
  return prisma.notification.findMany({
    where: { userId, type, channel: 'IN_APP' },
    orderBy: { id: 'asc' },
    select: { id: true, title: true, entityId: true, readAt: true, actionUrl: true },
  });
}

beforeAll(async () => {
  if (!available) return;
  setStorageProvider(storage);
  world = await createLifecycleWorld('msg');
});

afterAll(async () => {
  if (!available) return;
  setStorageProvider(null);

  // `Attachment.uploadedById` is ON DELETE RESTRICT — a file's uploader cannot
  // be erased out from under it — so attachments go first, including the
  // pending ones that never reached a message.
  await prisma.attachment.deleteMany({ where: { uploadedById: { in: world.tracked.users } } });

  // Conversations hang off projects and cascade with them; DIRECT threads have
  // no parent, so they are removed via the members this suite created.
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: { in: world.tracked.users } },
    select: { conversationId: true },
  });
  await prisma.conversation.deleteMany({
    where: { id: { in: memberships.map((member) => member.conversationId) } },
  });

  await world.cleanup();
  await rm(storageRoot, { recursive: true, force: true });
});

describe.skipIf(!available)('opening conversations', () => {
  it('creates one thread per project and reuses it', async () => {
    const engagement = await world.engagement();
    const first = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    const second = await ensureProjectConversation(prisma, world.expert.actor, engagement.projectId);

    expect(second.id).toBe(first.id);
    expect(await prisma.conversation.count({ where: { projectId: engagement.projectId } })).toBe(1);
  });

  it('puts both parties to the engagement in it', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    expect([...conversation.memberUserIds].sort()).toEqual(
      [world.customer.userId, world.expert.userId].sort(),
    );
  });

  it('refuses someone who is not a party — and does not create a thread', async () => {
    const engagement = await world.engagement();
    await rejects(
      ensureProjectConversation(prisma, world.otherCustomer.actor, engagement.projectId),
      'FORBIDDEN',
    );
    expect(await prisma.conversation.count({ where: { projectId: engagement.projectId } })).toBe(0);
  });

  it('refuses a project that does not exist', async () => {
    await rejects(
      ensureProjectConversation(prisma, world.customer.actor, '00000000-0000-7000-8000-000000000000'),
      'NOT_FOUND',
    );
  });

  it('opens a direct thread between people who share an engagement, and reuses it', async () => {
    await world.engagement();
    const first = await ensureDirectConversation(prisma, world.customer.actor, world.expert.userId);
    const second = await ensureDirectConversation(prisma, world.expert.actor, world.customer.userId);

    expect(second.id).toBe(first.id);
    expect(first.type).toBe('DIRECT');
  });

  it('refuses a direct thread with a stranger, and with yourself', async () => {
    await rejects(
      ensureDirectConversation(prisma, world.customer.actor, world.otherExpert.userId),
      'NO_SHARED_ENGAGEMENT',
    );
    await rejects(
      ensureDirectConversation(prisma, world.customer.actor, world.customer.userId),
      'NO_SHARED_ENGAGEMENT',
    );
  });

  it('gives the same refusal for a user that does not exist, so existence cannot be probed', async () => {
    const refusal = await rejects(
      ensureDirectConversation(prisma, world.customer.actor, '00000000-0000-7000-8000-00000000dead'),
      'NO_SHARED_ENGAGEMENT',
    );
    expect(refusal.message).toBe('You can only message someone you share a project or contract with.');
  });

  it('audits the opening of a thread', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    const audit = await prisma.auditLog.findMany({
      where: { entityId: conversation.id, action: AUDIT_ACTIONS.CONVERSATION_OPENED },
      select: { actorUserId: true },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(world.customer.userId);
  });
});

describe.skipIf(!available)('posting and reading', () => {
  it('posts, bumps the thread and notifies the other member only', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    const message = await postMessage(prisma, world.customer.actor, {
      conversationId: conversation.id,
      body: 'Could you confirm the scope of milestone one?',
    });

    expect(message.type).toBe('USER');
    expect(message.senderUserId).toBe(world.customer.userId);

    const stored = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: { lastMessageAt: true },
    });
    expect(stored.lastMessageAt).not.toBeNull();

    const toExpert = await notificationsOf(world.expert.userId, 'MESSAGE_RECEIVED');
    expect(toExpert.filter((row) => row.entityId === conversation.id)).toHaveLength(1);

    const toSelf = await notificationsOf(world.customer.userId, 'MESSAGE_RECEIVED');
    expect(toSelf.filter((row) => row.entityId === conversation.id)).toHaveLength(0);
  });

  it('never puts the message text into the notification', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    const secret = 'bank details: 1234567890';

    await postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: secret });

    const rows = await prisma.notification.findMany({
      where: { userId: world.expert.userId, entityId: conversation.id },
      select: { title: true, body: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.body).not.toContain(secret);
      expect(row.title).not.toContain(secret);
    }
  });

  it('does not notify a member who muted the thread', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    await setConversationMuted(prisma, world.expert.actor, conversation.id, true);

    await postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: 'Muted test.' });

    const rows = await prisma.notification.findMany({
      where: { userId: world.expert.userId, entityId: conversation.id },
    });
    expect(rows).toHaveLength(0);
  });

  it('refuses an empty message and one that is too long', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    await rejects(postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: '   ' }), 'FORBIDDEN');
    await rejects(
      postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: 'x'.repeat(10_001) }),
      'FORBIDDEN',
    );
  });

  it('refuses a non-member, for reading and for posting', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    await rejects(getConversation(prisma, world.otherCustomer.actor, conversation.id), 'FORBIDDEN');
    await rejects(
      postMessage(prisma, world.otherCustomer.actor, { conversationId: conversation.id, body: 'Hello?' }),
      'FORBIDDEN',
    );
  });

  it('lets an admin read but not post, and audits the read', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    await postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: 'Party talk.' });

    const page = await listMessages(prisma, world.admin.actor, conversation.id);
    expect(page.items.length).toBeGreaterThan(0);

    await rejects(
      postMessage(prisma, world.admin.actor, { conversationId: conversation.id, body: 'Admin speaking.' }),
      'FORBIDDEN',
    );

    const audit = await prisma.auditLog.findMany({
      where: { entityId: conversation.id, action: AUDIT_ACTIONS.CONVERSATION_READ_BY_OVERSIGHT },
      select: { actorUserId: true, severity: true },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: world.admin.userId, severity: 'NOTICE' });
  });

  it('does not audit a party reading their own thread', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    await listMessages(prisma, world.customer.actor, conversation.id);

    expect(
      await prisma.auditLog.count({
        where: { entityId: conversation.id, action: AUDIT_ACTIONS.CONVERSATION_READ_BY_OVERSIGHT },
      }),
    ).toBe(0);
  });

  it('refuses a reply whose parent is in another thread', async () => {
    const first = await world.engagement();
    const second = await world.engagement();
    const a = await ensureProjectConversation(prisma, world.customer.actor, first.projectId);
    const b = await ensureProjectConversation(prisma, world.customer.actor, second.projectId);

    const parent = await postMessage(prisma, world.customer.actor, { conversationId: a.id, body: 'In thread A.' });
    await rejects(
      postMessage(prisma, world.customer.actor, {
        conversationId: b.id,
        body: 'Replying across threads.',
        parentMessageId: parent.id,
      }),
      'NOT_FOUND',
    );
  });

  it('rate limits a flood from one sender in one thread', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    for (let index = 0; index < MESSAGE_RATE_LIMIT.maxMessages; index += 1) {
      await postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: `Message ${index}` });
    }
    await rejects(
      postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: 'One too many.' }),
      'RATE_LIMITED',
    );

    // The limit is per sender: the other party is unaffected.
    await postMessage(prisma, world.expert.actor, { conversationId: conversation.id, body: 'Still fine.' });
  });

  it('labels system and agent messages and never attributes them to a person', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    await postSystemMessage(prisma, { conversationId: conversation.id, body: 'Milestone one was funded.' });

    const agentRow = await prisma.aiAgent.upsert({
      where: { key: 'COMMUNICATION' },
      update: {},
      create: { key: 'COMMUNICATION', name: 'Communication Agent' },
      select: { id: true },
    });
    const run = await prisma.aiRun.create({
      data: {
        agentId: agentRow.id,
        status: 'SUCCEEDED',
        trigger: 'SYSTEM_EVENT',
        projectId: engagement.projectId,
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        inputPayload: { fixture: true },
      },
      select: { id: true },
    });
    world.tracked.runs.push(run.id);
    await postAgentMessage(prisma, { conversationId: conversation.id, body: 'A risk was detected.', aiRunId: run.id });

    const page = await listMessages(prisma, world.customer.actor, conversation.id);
    const system = page.items.find((item) => item.type === 'SYSTEM')!;
    const agent = page.items.find((item) => item.type === 'AI_AGENT')!;

    expect(system.senderUserId).toBeNull();
    expect(agent.senderUserId).toBeNull();
    expect(agent.senderName).toBeNull();
    // An agent message is always traceable to the run that produced it.
    expect(agent.aiRunId).toBe(run.id);
  });
});

describe.skipIf(!available)('editing, withdrawing and archiving', () => {
  it('lets the author edit and stamps the edit', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    const message = await postMessage(prisma, world.customer.actor, {
      conversationId: conversation.id,
      body: 'Teh scope is clear.',
    });

    const edited = await editMessage(prisma, world.customer.actor, message.id, 'The scope is clear.');
    expect(edited.body).toBe('The scope is clear.');
    expect(edited.editedAt).not.toBeNull();

    // The original text survives in the audit trail: an edit cannot erase what
    // was said.
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: message.id, action: AUDIT_ACTIONS.MESSAGE_EDITED },
      select: { beforeState: true },
    });
    expect(JSON.stringify(audit!.beforeState)).toContain('Teh scope is clear.');
  });

  it('refuses an edit by the other party', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    const message = await postMessage(prisma, world.customer.actor, {
      conversationId: conversation.id,
      body: 'Mine, not yours.',
    });

    await rejects(editMessage(prisma, world.expert.actor, message.id, 'Rewritten.'), 'MESSAGE_IMMUTABLE');
  });

  it('refuses an edit from someone outside the thread without telling them anything else', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    const message = await postMessage(prisma, world.customer.actor, {
      conversationId: conversation.id,
      body: 'Private.',
    });

    await rejects(editMessage(prisma, world.otherCustomer.actor, message.id, 'Rewritten.'), 'FORBIDDEN');
  });

  it('withdraws a message as a tombstone that keeps its place', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    const message = await postMessage(prisma, world.customer.actor, {
      conversationId: conversation.id,
      body: 'Sent in error.',
    });

    const deleted = await deleteMessage(prisma, world.customer.actor, message.id);
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.body).toBe('[message deleted]');

    const page = await listMessages(prisma, world.expert.actor, conversation.id);
    const seen = page.items.find((item) => item.id === message.id)!;
    expect(seen.body).toBe('[message deleted]');
    // The row is still there — deletion is visible, not silent.
    expect(await prisma.message.count({ where: { id: message.id } })).toBe(1);
  });

  it('refuses posting into an archived thread, and allows it again once reopened', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    await setConversationArchived(prisma, world.customer.actor, conversation.id, true);
    await rejects(
      postMessage(prisma, world.expert.actor, { conversationId: conversation.id, body: 'Anyone there?' }),
      'CONVERSATION_ARCHIVED',
    );
    // Reading still works while archived.
    expect((await getConversation(prisma, world.expert.actor, conversation.id)).isArchived).toBe(true);

    await setConversationArchived(prisma, world.expert.actor, conversation.id, false);
    await postMessage(prisma, world.expert.actor, { conversationId: conversation.id, body: 'Back open.' });
  });

  it('removes the thread from your inbox when you leave, and refuses you afterwards', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    await leaveConversation(prisma, world.expert.actor, conversation.id);

    await rejects(getConversation(prisma, world.expert.actor, conversation.id), 'FORBIDDEN');
    const inbox = await listConversations(prisma, world.expert.actor, {});
    expect(inbox.items.map((item) => item.id)).not.toContain(conversation.id);
    // The other party still has it.
    expect((await getConversation(prisma, world.customer.actor, conversation.id)).id).toBe(conversation.id);
  });
});

describe.skipIf(!available)('unread tracking', () => {
  it('counts what the other party sent and clears on read', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    await postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: 'One.' });
    await postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: 'Two.' });

    const forExpert = await getConversation(prisma, world.expert.actor, conversation.id);
    expect(forExpert.unreadCount).toBe(2);

    // Your own messages are never unread to you.
    expect((await getConversation(prisma, world.customer.actor, conversation.id)).unreadCount).toBe(0);

    await markConversationRead(prisma, world.expert.actor, conversation.id);
    expect((await getConversation(prisma, world.expert.actor, conversation.id)).unreadCount).toBe(0);
  });

  it('adds up across threads', async () => {
    const before = await totalUnreadMessages(prisma, world.expert.actor);

    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    await postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: 'Unread.' });

    expect(await totalUnreadMessages(prisma, world.expert.actor)).toBe(before + 1);
  });
});

describe.skipIf(!available)('attachments', () => {
  const pdf = Buffer.from('%PDF-1.7 test document');

  async function reserved(conversationId: string) {
    return reserveUpload(
      prisma,
      world.customer.actor,
      { conversationId, fileName: 'brief.pdf', mimeType: 'application/pdf', sizeBytes: pdf.byteLength },
      storage,
    );
  }

  it('runs reserve, upload, confirm and attach', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    const ticket = await reserved(conversation.id);
    // The key is derived, never the client's file name.
    expect(ticket.fileKey).toMatch(/^messages\/[^/]+\/[^/]+\/[^/]+\.pdf$/);

    await storage.put(ticket.fileKey, pdf);
    const confirmed = await confirmUpload(prisma, world.customer.actor, ticket.attachmentId, storage);
    expect(confirmed.sizeBytes).toBe(pdf.byteLength);

    const message = await postMessage(prisma, world.customer.actor, {
      conversationId: conversation.id,
      body: 'The brief is attached.',
      attachmentIds: [ticket.attachmentId],
    });
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]!.fileName).toBe('brief.pdf');
  });

  it('refuses to attach a file that was never uploaded', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    const ticket = await reserved(conversation.id);

    await rejects(confirmUpload(prisma, world.customer.actor, ticket.attachmentId, storage), 'UPLOAD_INCOMPLETE');
    await rejects(
      postMessage(prisma, world.customer.actor, {
        conversationId: conversation.id,
        body: 'Attached.',
        attachmentIds: [ticket.attachmentId],
      }),
      'UPLOAD_INCOMPLETE',
    );
  });

  it('refuses a file whose real size differs from what was declared', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    const ticket = await reserved(conversation.id);

    await storage.put(ticket.fileKey, Buffer.from('a much longer file than was declared'));
    await rejects(confirmUpload(prisma, world.customer.actor, ticket.attachmentId, storage), 'ATTACHMENT_REJECTED');
    // The bytes are removed and the row retired, so a retry starts clean.
    expect(await storage.head(ticket.fileKey)).toBeNull();
  });

  it('refuses a disallowed file type', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    await rejects(
      reserveUpload(
        prisma,
        world.customer.actor,
        { conversationId: conversation.id, fileName: 'payload.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 },
        storage,
      ),
      'ATTACHMENT_REJECTED',
    );
  });

  it('refuses a reservation from someone who cannot post in the thread', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);

    await rejects(
      reserveUpload(
        prisma,
        world.otherCustomer.actor,
        { conversationId: conversation.id, fileName: 'brief.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
        storage,
      ),
      'FORBIDDEN',
    );
  });

  it('lets the other party download an attached file and hides a pending one', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    const ticket = await reserved(conversation.id);

    // Pending: nobody but the uploader can see it.
    await rejects(getAttachmentDownload(prisma, world.expert.actor, ticket.attachmentId, storage), 'NOT_FOUND');

    await storage.put(ticket.fileKey, pdf);
    await confirmUpload(prisma, world.customer.actor, ticket.attachmentId, storage);
    await postMessage(prisma, world.customer.actor, {
      conversationId: conversation.id,
      body: '',
      attachmentIds: [ticket.attachmentId],
    });

    const download = await getAttachmentDownload(prisma, world.expert.actor, ticket.attachmentId, storage);
    expect(download.fileName).toBe('brief.pdf');
    // And still not to an outsider.
    await rejects(getAttachmentDownload(prisma, world.otherCustomer.actor, ticket.attachmentId, storage), 'FORBIDDEN');
  });

  it('withdraws a message’s attachments with it', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    const ticket = await reserved(conversation.id);
    await storage.put(ticket.fileKey, pdf);
    await confirmUpload(prisma, world.customer.actor, ticket.attachmentId, storage);
    const message = await postMessage(prisma, world.customer.actor, {
      conversationId: conversation.id,
      body: 'Attached.',
      attachmentIds: [ticket.attachmentId],
    });

    await deleteMessage(prisma, world.customer.actor, message.id);

    const row = await prisma.attachment.findUniqueOrThrow({
      where: { id: ticket.attachmentId },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();
    await rejects(getAttachmentDownload(prisma, world.expert.actor, ticket.attachmentId, storage), 'NOT_FOUND');
  });
});

describe.skipIf(!available)('notifications', () => {
  it('lists, marks read and clears', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    await postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: 'Ping.' });

    const before = await unreadNotificationCount(prisma, world.expert.actor);
    expect(before).toBeGreaterThan(0);

    const page = await listNotifications(prisma, world.expert.actor, { unreadOnly: true });
    expect(page.items.every((item) => item.readAt === null)).toBe(true);
    // Only in-app rows are listed, never the email accounting rows.
    expect(page.items.every((item) => item.channel === 'IN_APP')).toBe(true);

    expect(await markNotificationRead(prisma, world.expert.actor, page.items[0]!.id)).toBe(true);
    expect(await unreadNotificationCount(prisma, world.expert.actor)).toBe(before - 1);

    await markAllNotificationsRead(prisma, world.expert.actor);
    expect(await unreadNotificationCount(prisma, world.expert.actor)).toBe(0);
  });

  it('does not let one user mark another user’s notification read', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    await postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: 'Ping.' });

    const theirs = await listNotifications(prisma, world.expert.actor, { unreadOnly: true });
    const target = theirs.items[0]!;

    expect(await markNotificationRead(prisma, world.otherCustomer.actor, target.id)).toBe(false);
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: target.id }, select: { readAt: true } });
    expect(after.readAt).toBeNull();
  });

  it('reports every type, marking which are the platform default', async () => {
    const preferences = await listPreferences(prisma, world.customer.actor);
    expect(preferences).toHaveLength(22);
    expect(preferences.every((preference) => preference.isDefault)).toBe(true);

    const updated = await updatePreference(prisma, world.customer.actor, 'MESSAGE_RECEIVED', { email: false });
    expect(updated).toMatchObject({ type: 'MESSAGE_RECEIVED', email: false, inApp: true, isDefault: false });

    const after = await listPreferences(prisma, world.customer.actor);
    expect(after.find((preference) => preference.type === 'MESSAGE_RECEIVED')).toMatchObject({
      email: false,
      isDefault: false,
    });
  });

  it('honours a preference when the notification is raised', async () => {
    await updatePreference(prisma, world.otherExpert.actor, 'MESSAGE_RECEIVED', { inApp: false, email: false });

    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    await prisma.conversationMember.create({ data: { conversationId: conversation.id, userId: world.otherExpert.userId } });

    await postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: 'Silent for one of you.' });

    expect(
      await prisma.notification.count({ where: { userId: world.otherExpert.userId, entityId: conversation.id } }),
    ).toBe(0);
    expect(
      await prisma.notification.count({ where: { userId: world.expert.userId, entityId: conversation.id } }),
    ).toBeGreaterThan(0);
  });

  it('queues external channels and dispatches them out of band', async () => {
    const engagement = await world.engagement();
    const conversation = await ensureProjectConversation(prisma, world.customer.actor, engagement.projectId);
    await postMessage(prisma, world.customer.actor, { conversationId: conversation.id, body: 'Email me.' });

    const email = await prisma.notification.findFirstOrThrow({
      where: { userId: world.expert.userId, entityId: conversation.id, channel: 'EMAIL' },
      select: { id: true, sentAt: true },
    });
    // Recorded, not yet sent: no provider call happened inside the transaction.
    expect(email.sentAt).toBeNull();

    const summary = await dispatchPending(prisma, 100);
    expect(summary.attempted).toBeGreaterThan(0);

    const after = await prisma.notification.findUniqueOrThrow({
      where: { id: email.id },
      select: { sentAt: true, failedAt: true },
    });
    expect(after.sentAt).not.toBeNull();
    expect(after.failedAt).toBeNull();
  });
});

describe.skipIf(!available)('lifecycle transitions notify the parties', () => {
  it('tells the customer when the expert submits, and not the expert', async () => {
    const engagement = await world.engagement({ milestoneStatus: 'IN_PROGRESS' });
    await world.newDeliverable(engagement.milestoneId);

    const before = (await notificationsOf(world.customer.userId, 'MILESTONE_SUBMITTED')).length;

    const outcome = await transitionMilestone({
      entityId: engagement.milestoneId,
      event: 'SUBMIT',
      actor: { kind: 'HUMAN', actor: world.expert.actor },
    });
    expect(outcome.result).toBe('APPLIED');

    const after = await notificationsOf(world.customer.userId, 'MILESTONE_SUBMITTED');
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)!.entityId).toBe(engagement.milestoneId);
    // Links to the project surface, not to a role-specific route.
    expect(after.at(-1)!.actionUrl).toBe(`/projects/${engagement.projectId}/milestones`);

    // The person who acted is never told about their own action.
    expect(
      await prisma.notification.count({
        where: { userId: world.expert.userId, entityId: engagement.milestoneId, type: 'MILESTONE_SUBMITTED' },
      }),
    ).toBe(0);
  });

  it('tells the expert when the customer approves', async () => {
    const engagement = await world.engagement({ milestoneStatus: 'IN_PROGRESS' });
    await world.newDeliverable(engagement.milestoneId);

    await transitionMilestone({
      entityId: engagement.milestoneId,
      event: 'SUBMIT',
      actor: { kind: 'HUMAN', actor: world.expert.actor },
    });
    await transitionMilestone({
      entityId: engagement.milestoneId,
      event: 'BEGIN_REVIEW',
      actor: { kind: 'HUMAN', actor: world.customer.actor },
    });
    await transitionMilestone({
      entityId: engagement.milestoneId,
      event: 'APPROVE',
      actor: { kind: 'HUMAN', actor: world.customer.actor },
    });

    expect(
      await prisma.notification.count({
        where: {
          userId: world.expert.userId,
          entityId: engagement.milestoneId,
          type: 'MILESTONE_APPROVED',
          channel: 'IN_APP',
        },
      }),
    ).toBe(1);
  });

  it('records the count on the transition audit entry', async () => {
    const engagement = await world.engagement({ milestoneStatus: 'IN_PROGRESS' });
    await world.newDeliverable(engagement.milestoneId);
    await transitionMilestone({
      entityId: engagement.milestoneId,
      event: 'SUBMIT',
      actor: { kind: 'HUMAN', actor: world.expert.actor },
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: engagement.milestoneId, action: AUDIT_ACTIONS.MILESTONE_TRANSITIONED },
      orderBy: { id: 'desc' },
      select: { afterState: true },
    });
    expect(JSON.stringify(audit.afterState)).toContain('notificationsRecorded');
  });

  it('leaves unmapped transitions notifying nobody', async () => {
    const engagement = await world.engagement({ milestoneStatus: 'FUNDED' });
    const before = await prisma.notification.count({ where: { entityId: engagement.milestoneId } });

    await transitionMilestone({
      entityId: engagement.milestoneId,
      event: 'START',
      actor: { kind: 'HUMAN', actor: world.expert.actor },
    });

    expect(await prisma.notification.count({ where: { entityId: engagement.milestoneId } })).toBe(before);
  });
});

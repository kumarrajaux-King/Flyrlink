/**
 * Attachments: reserving them, confirming them, serving them.
 *
 * THE THREE-STEP UPLOAD, AND WHY IT IS THREE STEPS
 *   1. **Reserve.** The client describes the file. The server validates the
 *      description, derives a storage key from values the client does not
 *      control, and writes a *pending* attachment row.
 *   2. **Upload.** The client sends the bytes straight to storage using the
 *      ticket. They never pass through a request handler.
 *   3. **Confirm.** The server asks storage what actually landed and compares it
 *      with what was promised. Only then is the attachment usable.
 *
 *   Collapsing this into one step means either streaming 25 MB through the
 *   application, or trusting the client's word that the file exists and is what
 *   it said. Step 3 is what makes a lie detectable: a row whose object is
 *   missing, or whose real size differs from the declared size, is refused
 *   rather than shown in a thread as though it were there.
 *
 * WHAT IS STILL MISSING
 *   Malware scanning. It belongs between steps 2 and 3, needs a scanning
 *   service nobody has procured, and is recorded as a blocking input (`M-10`)
 *   rather than quietly skipped. Until it exists, attachments are validated by
 *   type, extension and size, and served with headers that stop a browser
 *   deciding for itself what a file is.
 */

import { createHash } from 'node:crypto';

import {
  type AttachmentRefusal,
  attachmentRefusalMessage,
  buildFileKey,
  sanitizeFileName,
  uploadRefusal,
} from '../../domain/attachment/rules';
import { canPostToConversation, conversationDenialMessage } from '../../domain/messaging/conversation-access';
import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import type { Actor } from '../../lib/authz/authorize';
import type { Db } from '../../lib/db/client';
import { type StorageProvider, newObjectId, storageProvider } from '../../lib/storage/provider';
import { MessagingRejection, loadReadable, notFound, subjectOf } from './conversation-service';

export interface UploadRequest {
  readonly conversationId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface ReservedUpload {
  readonly attachmentId: string;
  readonly fileKey: string;
  readonly upload: {
    readonly url: string;
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly expiresAt: string;
  };
}

function reject(refusal: AttachmentRefusal): never {
  throw new MessagingRejection('ATTACHMENT_REJECTED', attachmentRefusalMessage(refusal));
}

/**
 * Step 1 — validate the description and reserve a key.
 *
 * Requires permission to *post* in the thread, not merely to read it: an
 * oversight reader has no business placing files in two parties' conversation.
 */
export async function reserveUpload(
  db: Db,
  actor: Actor,
  input: UploadRequest,
  storage: StorageProvider = storageProvider(),
): Promise<ReservedUpload> {
  const { row: conversation } = await loadReadable(db, actor, input.conversationId);

  const decision = canPostToConversation(actor, subjectOf(conversation));
  if (!decision.allowed) {
    throw new MessagingRejection(
      decision.reason === 'CONVERSATION_ARCHIVED' ? 'CONVERSATION_ARCHIVED' : 'FORBIDDEN',
      conversationDenialMessage(decision.reason),
    );
  }

  const refusal = uploadRefusal(input);
  if (refusal) reject(refusal);

  const fileName = sanitizeFileName(input.fileName);
  const fileKey = buildFileKey({
    scope: 'messages',
    scopeId: input.conversationId,
    uploaderUserId: actor.userId,
    uniqueId: newObjectId(),
    fileName,
  });

  const attachment = await db.attachment.create({
    data: {
      // Pending: linked to no message until the upload is confirmed and the
      // message that carries it is posted.
      messageId: null,
      uploadedById: actor.userId,
      fileName,
      fileKey,
      mimeType: input.mimeType.split(';')[0]!.trim().toLowerCase(),
      sizeBytes: input.sizeBytes,
      // Set at confirmation, from the bytes that actually landed.
      checksum: null,
    },
    select: { id: true },
  });

  const ticket = await storage.createUploadTicket(fileKey, input.mimeType);

  return {
    attachmentId: attachment.id,
    fileKey,
    upload: {
      url: ticket.url,
      method: ticket.method,
      headers: ticket.headers,
      expiresAt: ticket.expiresAt.toISOString(),
    },
  };
}

/**
 * Step 3 — check what landed against what was promised.
 *
 * A size mismatch is a refusal, not a correction: accepting a file that is not
 * the file that was validated would make the size cap advisory.
 */
export async function confirmUpload(
  db: Db,
  actor: Actor,
  attachmentId: string,
  storage: StorageProvider = storageProvider(),
  context: RequestContext = {},
): Promise<{ attachmentId: string; sizeBytes: number; checksum: string }> {
  const attachment = await db.attachment.findFirst({
    where: { id: attachmentId, uploadedById: actor.userId, deletedAt: null },
    select: { id: true, fileKey: true, sizeBytes: true, messageId: true },
  });
  if (!attachment) throw notFound('attachment');

  const stored = await storage.head(attachment.fileKey);
  if (!stored) {
    throw new MessagingRejection('UPLOAD_INCOMPLETE', 'No file has been uploaded for this attachment yet.');
  }
  if (stored.sizeBytes !== attachment.sizeBytes) {
    await storage.remove(attachment.fileKey);
    await db.attachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date() } });
    throw new MessagingRejection(
      'ATTACHMENT_REJECTED',
      'The uploaded file does not match what was declared. Start the upload again.',
    );
  }

  await db.attachment.update({ where: { id: attachment.id }, data: { checksum: stored.checksum } });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.ATTACHMENT_UPLOADED,
    entityType: 'Attachment',
    entityId: attachment.id,
    actorUserId: actor.userId,
    afterState: { sizeBytes: stored.sizeBytes, checksum: stored.checksum },
    ...context,
  });

  return { attachmentId: attachment.id, sizeBytes: stored.sizeBytes, checksum: stored.checksum };
}

/**
 * Link confirmed attachments to a message being posted.
 *
 * Refuses anything that is not the caller's own, already attached elsewhere, or
 * not yet confirmed — so a message cannot carry a file that does not exist, or
 * a file belonging to someone else's thread.
 */
export async function linkAttachments(
  db: Db,
  actor: Actor,
  messageId: string,
  attachmentIds: readonly string[],
): Promise<number> {
  if (attachmentIds.length === 0) return 0;

  const usable = await db.attachment.findMany({
    where: {
      id: { in: [...attachmentIds] },
      uploadedById: actor.userId,
      messageId: null,
      deletedAt: null,
      // Confirmed uploads only: `checksum` is written by `confirmUpload`.
      checksum: { not: null },
    },
    select: { id: true },
  });

  if (usable.length !== attachmentIds.length) {
    throw new MessagingRejection(
      'UPLOAD_INCOMPLETE',
      'Every attachment must be uploaded and confirmed before the message is sent.',
    );
  }

  const result = await db.attachment.updateMany({
    where: { id: { in: usable.map((attachment) => attachment.id) }, messageId: null },
    data: { messageId },
  });
  return result.count;
}

export interface AttachmentDownload {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly url: string;
  readonly expiresAt: string;
}

/** A time-limited read link, for someone who may read the thread it is in. */
export async function getAttachmentDownload(
  db: Db,
  actor: Actor,
  attachmentId: string,
  storage: StorageProvider = storageProvider(),
): Promise<AttachmentDownload> {
  const attachment = await db.attachment.findFirst({
    where: { id: attachmentId, deletedAt: null },
    select: {
      fileKey: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedById: true,
      message: { select: { conversationId: true, deletedAt: true } },
    },
  });
  if (!attachment) throw notFound('attachment');

  if (attachment.message) {
    if (attachment.message.deletedAt !== null) throw notFound('attachment');
    // Access follows the thread the file was sent in.
    await loadReadable(db, actor, attachment.message.conversationId);
  } else if (attachment.uploadedById !== actor.userId) {
    // Still pending: only its uploader can see it.
    throw notFound('attachment');
  }

  const link = await storage.createDownloadUrl(attachment.fileKey);
  return {
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    url: link.url,
    expiresAt: link.expiresAt.toISOString(),
  };
}

/** Withdraw an attachment you uploaded. Soft, like message deletion. */
export async function deleteAttachment(
  db: Db,
  actor: Actor,
  attachmentId: string,
  context: RequestContext = {},
): Promise<void> {
  const result = await db.attachment.updateMany({
    where: { id: attachmentId, uploadedById: actor.userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw notFound('attachment');

  await writeAudit(db, {
    action: AUDIT_ACTIONS.ATTACHMENT_DELETED,
    entityType: 'Attachment',
    entityId: attachmentId,
    actorUserId: actor.userId,
    ...context,
  });
}

/**
 * Authorise a raw byte transfer for the development storage adapter.
 *
 * The local adapter has no signed URLs — there is no service to sign against —
 * so the development content route asks here instead, and the answer is the
 * same rule the ticket would have encoded: the uploader may write to a pending
 * key of their own, and anyone who may read the thread may read a linked one.
 */
export async function authorizeKeyAccess(
  db: Db,
  actor: Actor,
  fileKey: string,
  intent: 'READ' | 'WRITE',
): Promise<{ mimeType: string; fileName: string }> {
  const attachment = await db.attachment.findFirst({
    where: { fileKey, deletedAt: null },
    select: {
      uploadedById: true,
      mimeType: true,
      fileName: true,
      messageId: true,
      message: { select: { conversationId: true, deletedAt: true } },
    },
  });
  if (!attachment) throw notFound('attachment');

  if (intent === 'WRITE') {
    // Only the uploader, and only before it is attached to a message: once a
    // message carries it, its bytes are part of the record.
    if (attachment.uploadedById !== actor.userId || attachment.messageId !== null) {
      throw notFound('attachment');
    }
    return { mimeType: attachment.mimeType, fileName: attachment.fileName };
  }

  if (attachment.message) {
    if (attachment.message.deletedAt !== null) throw notFound('attachment');
    await loadReadable(db, actor, attachment.message.conversationId);
  } else if (attachment.uploadedById !== actor.userId) {
    throw notFound('attachment');
  }

  return { mimeType: attachment.mimeType, fileName: attachment.fileName };
}

/** SHA-256 of a buffer, matching what the storage adapter reports. */
export function checksumOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

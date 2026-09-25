/**
 * Zod schemas for the messaging, attachment and notification API.
 *
 * `strictObject` throughout, so a client cannot smuggle in anything the server
 * decides: not the sender, not the message type (USER always — SYSTEM and
 * AI_AGENT have no route), not `sentAt`, not a conversation's membership, not an
 * attachment's storage key or checksum. Those exist only for server-side callers
 * and are deliberately absent here.
 *
 * Query strings are validated the same way — an unknown parameter is a 422
 * rather than being silently ignored, so a typo in a filter fails loudly instead
 * of returning a wider result set than the caller meant.
 */

import { z } from 'zod';

import { MAX_ATTACHMENT_BYTES } from '../../domain/attachment/rules';
import { MESSAGE_MAX_LENGTH } from '../../domain/messaging/message-rules';
import { NOTIFICATION_TYPES } from '../../domain/notification/routing';
import { MAX_PAGE_SIZE } from './admin';

const cursor = z.uuid().optional();
const limit = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional();
const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

export const conversationListQuerySchema = z.strictObject({
  cursor,
  limit,
  includeArchived: flag.optional(),
});

/**
 * Opening a conversation names exactly one subject.
 *
 * A union rather than four optional fields, so "which thread?" cannot be
 * ambiguous and cannot be empty.
 */
export const openConversationSchema = z.discriminatedUnion('scope', [
  z.strictObject({ scope: z.literal('PROJECT'), projectId: z.uuid() }),
  z.strictObject({ scope: z.literal('CONTRACT'), contractId: z.uuid() }),
  z.strictObject({ scope: z.literal('TEAM'), teamId: z.uuid() }),
  z.strictObject({ scope: z.literal('DIRECT'), userId: z.uuid() }),
]);

export const messageListQuerySchema = z.strictObject({ cursor, limit });

export const postMessageSchema = z.strictObject({
  // Empty is allowed here and refused by the service only when there are also
  // no attachments — the rule is "a message must carry something", and it is
  // one rule in one place rather than two half-rules.
  body: z.string().max(MESSAGE_MAX_LENGTH).default(''),
  parentMessageId: z.uuid().optional(),
  attachmentIds: z.array(z.uuid()).max(10).optional(),
});

export const editMessageSchema = z.strictObject({
  body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});

export const conversationSettingsSchema = z
  .strictObject({
    isMuted: z.boolean().optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((value) => value.isMuted !== undefined || value.isArchived !== undefined, {
    message: 'Provide isMuted or isArchived.',
  });

export const reserveUploadSchema = z.strictObject({
  conversationId: z.uuid(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
});

export const notificationListQuerySchema = z.strictObject({
  cursor,
  limit,
  unreadOnly: flag.optional(),
});

export const updatePreferenceSchema = z.strictObject({
  type: z.enum(NOTIFICATION_TYPES),
  inApp: z.boolean().optional(),
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
  whatsapp: z.boolean().optional(),
});

/**
 * Parse a URL's search parameters against a schema.
 *
 * Repeated parameters collapse to the last value, which is what every client
 * library produces for a scalar; an array-valued filter would declare itself in
 * its schema.
 */
export function parseQuery<T>(url: string, schema: { parse: (input: unknown) => T }): T {
  const params = new URL(url).searchParams;
  const raw: Record<string, string> = {};
  for (const [key, value] of params.entries()) raw[key] = value;
  return schema.parse(raw);
}

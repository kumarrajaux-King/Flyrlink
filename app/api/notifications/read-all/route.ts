/**
 * POST /api/notifications/read-all — clear the caller's unread badge.
 *
 * Returns how many rows changed, so a client that raced another tab can tell
 * that it did nothing rather than assuming it did.
 */

import { prisma } from '../../../../lib/db/client';
import { handleMessagingRequest } from '../../../../lib/http/messaging';
import { ok } from '../../../../lib/http/response';
import { markAllNotificationsRead } from '../../../../services/notification/notification-service';

export async function POST(request: Request): Promise<Response> {
  return handleMessagingRequest(request, async (session, requestId) =>
    ok({ read: await markAllNotificationsRead(prisma, session.actor) }, requestId),
  );
}

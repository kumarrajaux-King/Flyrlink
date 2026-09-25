/**
 * GET /api/notifications/summary — the two counts the top bar needs.
 *
 * One endpoint rather than two, because the header renders both badges together
 * and polling them separately doubles the request rate for no benefit.
 */

import { prisma } from '../../../../lib/db/client';
import { handleMessagingRequest } from '../../../../lib/http/messaging';
import { ok } from '../../../../lib/http/response';
import { totalUnreadMessages } from '../../../../services/messaging/message-service';
import { unreadNotificationCount } from '../../../../services/notification/notification-service';

export async function GET(request: Request): Promise<Response> {
  return handleMessagingRequest(request, async (session, requestId) => {
    const [notifications, messages] = await Promise.all([
      unreadNotificationCount(prisma, session.actor),
      totalUnreadMessages(prisma, session.actor),
    ]);
    return ok({ unreadNotifications: notifications, unreadMessages: messages }, requestId);
  });
}

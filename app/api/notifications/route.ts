/**
 * GET /api/notifications — the caller's own in-app notifications.
 *
 * In-app rows only. Email and SMS rows exist for delivery accounting, and
 * listing them here would show the same event three times.
 *
 * There is no way to read anyone else's: no permission grants it, and no admin
 * route reaches this service. An administrator investigating a case reads the
 * audit log and the underlying records, not a person's inbox.
 */

import { prisma } from '../../../lib/db/client';
import { handleMessagingRequest } from '../../../lib/http/messaging';
import { ok } from '../../../lib/http/response';
import { notificationListQuerySchema, parseQuery } from '../../../lib/validation/messaging';
import { listNotifications } from '../../../services/notification/notification-service';

export async function GET(request: Request): Promise<Response> {
  return handleMessagingRequest(request, async (session, requestId) => {
    const query = parseQuery(request.url, notificationListQuerySchema);
    return ok(await listNotifications(prisma, session.actor, query), requestId);
  });
}

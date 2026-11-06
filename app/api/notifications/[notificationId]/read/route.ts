/**
 * POST /api/notifications/:id/read — mark one notification read.
 *
 * Scoped to the caller in the same statement as the id, so a guessed id
 * belonging to someone else updates nothing. The response does not distinguish
 * "not yours" from "not there" — both are 404, which is the honest answer to
 * both from where the caller stands.
 */

import { prisma } from '../../../../../lib/db/client';
import { handleMessagingRequest } from '../../../../../lib/http/messaging';
import { fail, ok } from '../../../../../lib/http/response';
import { markNotificationRead } from '../../../../../services/notification/notification-service';

interface RouteParams {
  readonly params: Promise<{ notificationId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { notificationId } = await params;
  return handleMessagingRequest(request, async (session, requestId) => {
    const changed = await markNotificationRead(prisma, session.actor, notificationId);
    // Already-read is a success: the caller's intent holds either way.
    if (!changed) {
      const exists = await prisma.notification.count({
        where: { id: notificationId, userId: session.actor.userId },
      });
      if (exists === 0) return fail('NOT_FOUND', 'No notification with that id.', 404, requestId);
    }
    return ok({ read: true }, requestId);
  });
}

/**
 * POST /api/conversations/:id/read — mark the thread read up to now.
 *
 * Idempotent: calling it twice simply moves the marker to the later instant.
 * The marker is per-member, so marking read never affects what anyone else sees.
 */

import { prisma } from '../../../../../lib/db/client';
import { handleMessagingRequest } from '../../../../../lib/http/messaging';
import { ok } from '../../../../../lib/http/response';
import { markConversationRead } from '../../../../../services/messaging/conversation-service';

interface RouteParams {
  readonly params: Promise<{ conversationId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { conversationId } = await params;
  return handleMessagingRequest(request, async (session, requestId) =>
    ok(await markConversationRead(prisma, session.actor, conversationId), requestId),
  );
}

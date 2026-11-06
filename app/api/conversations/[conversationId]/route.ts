/**
 * GET    /api/conversations/:id — one conversation.
 * PATCH  /api/conversations/:id — mute for yourself, or archive for everyone.
 * DELETE /api/conversations/:id — leave it. The thread is not deleted.
 *
 * DELETE reads as "remove it from my inbox", which is what leaving does; the
 * conversation and its history stay for the other parties and for oversight.
 * Nothing in the messaging layer deletes a conversation.
 */

import { prisma } from '../../../../lib/db/client';
import { parseJsonBody, requestContext } from '../../../../lib/http/auth-context';
import { handleMessagingRequest } from '../../../../lib/http/messaging';
import { ok } from '../../../../lib/http/response';
import { conversationSettingsSchema } from '../../../../lib/validation/messaging';
import {
  getConversation,
  leaveConversation,
  setConversationArchived,
  setConversationMuted,
} from '../../../../services/messaging/conversation-service';

interface RouteParams {
  readonly params: Promise<{ conversationId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { conversationId } = await params;
  return handleMessagingRequest(request, async (session, requestId) =>
    ok(await getConversation(prisma, session.actor, conversationId), requestId),
  );
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  const { conversationId } = await params;
  return handleMessagingRequest(request, async (session, requestId) => {
    const body = await parseJsonBody(request, conversationSettingsSchema);
    const context = requestContext(request, requestId);

    if (body.isMuted !== undefined) {
      await setConversationMuted(prisma, session.actor, conversationId, body.isMuted);
    }
    if (body.isArchived !== undefined) {
      await setConversationArchived(prisma, session.actor, conversationId, body.isArchived, context);
    }

    return ok(await getConversation(prisma, session.actor, conversationId), requestId);
  });
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const { conversationId } = await params;
  return handleMessagingRequest(request, async (session, requestId) => {
    await leaveConversation(prisma, session.actor, conversationId, requestContext(request, requestId));
    return ok({ left: true }, requestId);
  });
}

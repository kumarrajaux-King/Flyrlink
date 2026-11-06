/**
 * PATCH  /api/messages/:id — correct your own message, inside the edit window.
 * DELETE /api/messages/:id — withdraw your own message.
 *
 * Deletion is soft and visible: the message keeps its place in the thread as a
 * tombstone. A message that silently disappeared would let one party rewrite
 * the history the other remembers.
 */

import { prisma } from '../../../../lib/db/client';
import { parseJsonBody, requestContext } from '../../../../lib/http/auth-context';
import { handleMessagingRequest } from '../../../../lib/http/messaging';
import { ok } from '../../../../lib/http/response';
import { editMessageSchema } from '../../../../lib/validation/messaging';
import { deleteMessage, editMessage } from '../../../../services/messaging/message-service';

interface RouteParams {
  readonly params: Promise<{ messageId: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  const { messageId } = await params;
  return handleMessagingRequest(request, async (session, requestId) => {
    const body = await parseJsonBody(request, editMessageSchema);
    const message = await editMessage(
      prisma,
      session.actor,
      messageId,
      body.body,
      requestContext(request, requestId),
    );
    return ok(message, requestId);
  });
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const { messageId } = await params;
  return handleMessagingRequest(request, async (session, requestId) =>
    ok(
      await deleteMessage(prisma, session.actor, messageId, requestContext(request, requestId)),
      requestId,
    ),
  );
}

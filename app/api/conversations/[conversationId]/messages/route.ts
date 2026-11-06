/**
 * GET  /api/conversations/:id/messages — a page of the thread, newest first.
 * POST /api/conversations/:id/messages — post a message as the session's human.
 *
 * The message type is always USER here. SYSTEM and AI_AGENT messages are
 * written by server-side callers only, for the same reason the lifecycle routes
 * only ever build a HUMAN actor: an actor kind a client can choose is an actor
 * kind a client can forge.
 */

import { prisma } from '../../../../../lib/db/client';
import { parseJsonBody, requestContext } from '../../../../../lib/http/auth-context';
import { handleMessagingRequest } from '../../../../../lib/http/messaging';
import { ok } from '../../../../../lib/http/response';
import { messageListQuerySchema, parseQuery, postMessageSchema } from '../../../../../lib/validation/messaging';
import { listMessages, postMessage } from '../../../../../services/messaging/message-service';

interface RouteParams {
  readonly params: Promise<{ conversationId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { conversationId } = await params;
  return handleMessagingRequest(request, async (session, requestId) => {
    const query = parseQuery(request.url, messageListQuerySchema);
    const page = await listMessages(
      prisma,
      session.actor,
      conversationId,
      query,
      requestContext(request, requestId),
    );
    return ok(page, requestId);
  });
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { conversationId } = await params;
  return handleMessagingRequest(request, async (session, requestId) => {
    const body = await parseJsonBody(request, postMessageSchema);
    const message = await postMessage(
      prisma,
      session.actor,
      { conversationId, ...body },
      requestContext(request, requestId),
    );
    return ok(message, requestId, 201);
  });
}

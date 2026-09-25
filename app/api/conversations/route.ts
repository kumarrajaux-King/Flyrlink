/**
 * GET  /api/conversations — the caller's inbox, most recently active first.
 * POST /api/conversations — open (or reuse) the thread for an engagement.
 *
 * Opening is idempotent: a second call returns the same conversation rather
 * than a second thread. Who may open one, and who ends up in it, are the
 * conversation service's decisions.
 */

import { handleMessagingRequest } from '../../../lib/http/messaging';
import { parseJsonBody } from '../../../lib/http/auth-context';
import { requestContext } from '../../../lib/http/auth-context';
import { ok } from '../../../lib/http/response';
import { conversationListQuerySchema, openConversationSchema, parseQuery } from '../../../lib/validation/messaging';
import { prisma } from '../../../lib/db/client';
import {
  ensureContractConversation,
  ensureDirectConversation,
  ensureProjectConversation,
  ensureTeamConversation,
  listConversations,
} from '../../../services/messaging/conversation-service';

export async function GET(request: Request): Promise<Response> {
  return handleMessagingRequest(request, async (session, requestId) => {
    const query = parseQuery(request.url, conversationListQuerySchema);
    const page = await listConversations(prisma, session.actor, query);
    return ok(page, requestId);
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleMessagingRequest(request, async (session, requestId) => {
    const body = await parseJsonBody(request, openConversationSchema);
    const context = requestContext(request, requestId);

    const conversation =
      body.scope === 'PROJECT'
        ? await ensureProjectConversation(prisma, session.actor, body.projectId, context)
        : body.scope === 'CONTRACT'
          ? await ensureContractConversation(prisma, session.actor, body.contractId, context)
          : body.scope === 'TEAM'
            ? await ensureTeamConversation(prisma, session.actor, body.teamId, context)
            : await ensureDirectConversation(prisma, session.actor, body.userId, context);

    return ok(conversation, requestId);
  });
}

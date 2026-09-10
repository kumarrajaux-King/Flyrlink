/**
 * GET /api/ai/agents — the agent registry with version history.
 *
 * Backs `/admin/ai/agents`: which agents exist, which version is active, which
 * model and prompt each version pins, and how many runs each has produced.
 */

import { requireSession } from '../../../../lib/http/auth-context';
import { errorResponse, ok, resolveRequestId } from '../../../../lib/http/response';
import { listAgents } from '../../../../services/ai/observability-service';

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const agents = await listAgents({ actor: session.actor });
    return ok({ agents }, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

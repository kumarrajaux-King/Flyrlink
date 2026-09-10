/**
 * GET /api/ai/approvals — the human approval queue (STEP 01 §6.4).
 *
 * Lists every AI action held pending a human decision, with the agent's
 * reasoning and the payload it proposed, so a reviewer can decide on evidence
 * rather than on trust.
 */

import { requireSession } from '../../../../lib/http/auth-context';
import { errorResponse, ok, resolveRequestId } from '../../../../lib/http/response';
import { listPendingApprovals } from '../../../../services/ai/approval-service';

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get('limit') ?? '50');
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

    const pending = await listPendingApprovals({ actor: session.actor, limit });
    return ok({ pending, count: pending.length }, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

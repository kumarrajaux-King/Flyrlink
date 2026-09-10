/**
 * GET /api/ai/runs/:runId — full detail for one run.
 *
 * Answers the master spec §34 traceability question: which agent, which version,
 * which model, which prompt, what it proposed, what a human decided, what it cost.
 */

import { requireSession } from '../../../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../../../lib/http/response';
import { getRunDetail } from '../../../../../services/ai/observability-service';

interface RouteParams {
  readonly params: Promise<{ runId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const { runId } = await params;

    const run = await getRunDetail({ actor: session.actor, runId });
    if (!run) return fail('NOT_FOUND', 'No such AI run.', 404, requestId);

    return ok({ run }, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

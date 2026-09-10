/**
 * GET /api/ai/runs — the AI run log (STEP 01 §6.4).
 */

import { requireSession } from '../../../../lib/http/auth-context';
import { errorResponse, ok, resolveRequestId } from '../../../../lib/http/response';
import { listRunsQuerySchema } from '../../../../lib/validation/ai';
import { listRuns } from '../../../../services/ai/observability-service';

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);

    const url = new URL(request.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    // Reject unknown query parameters the same way we reject unknown body fields.
    const query = listRunsQuerySchema.parse(raw);

    const runs = await listRuns({ actor: session.actor, ...query });
    return ok({ runs, count: runs.length }, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

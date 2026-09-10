/**
 * GET /api/ai/health — AI health metrics for the admin dashboard.
 *
 * Success and failure rates, spend, pending approvals, and the two numbers that
 * say whether the matching agent is actually trusted: match acceptance and human
 * override rate.
 */

import { requireSession } from '../../../../lib/http/auth-context';
import { errorResponse, ok, resolveRequestId } from '../../../../lib/http/response';
import { getHealthMetrics } from '../../../../services/ai/observability-service';

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const url = new URL(request.url);
    const days = Number(url.searchParams.get('days') ?? '30');
    const sinceMs = (Number.isFinite(days) ? Math.min(Math.max(days, 1), 365) : 30) * 86_400_000;

    const metrics = await getHealthMetrics({ actor: session.actor, sinceMs });
    return ok(metrics, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

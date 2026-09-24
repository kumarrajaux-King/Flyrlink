/**
 * GET /api/admin/ai/overview — usage, tokens and cost by agent, policy
 * decisions, approval outcomes and recent failures (`ai:read:any`). Read-only.
 *
 * The run log, run detail, health metrics, agent registry and approval queue are
 * the existing Phase 7 routes under /api/ai.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { aiOverviewQuerySchema } from '../../../../../lib/validation/admin';
import { getAiOperationsOverview } from '../../../../../services/admin/ai-operations-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, aiOverviewQuerySchema, (actor, query) =>
    getAiOperationsOverview({ actor, ...query }),
  );
}

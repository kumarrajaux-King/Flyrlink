/**
 * POST /api/milestones/:milestoneId/transitions — fire a milestone lifecycle event.
 *
 * Body: `{ event, expectedStatus?, params? }`. The caller is always a HUMAN
 * actor built from the session; SYSTEM, WEBHOOK and AI transitions are not
 * reachable over HTTP. The state machine, RBAC, ownership, contextual rules,
 * idempotency and audit are all the lifecycle service's.
 */

import { handleTransitionRequest } from '../../../../../lib/http/lifecycle';
import { milestoneTransitionSchema } from '../../../../../lib/validation/lifecycle';
import { transitionMilestone } from '../../../../../services/lifecycle';

interface RouteParams {
  readonly params: Promise<{ milestoneId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { milestoneId } = await params;
  return handleTransitionRequest(request, milestoneId, milestoneTransitionSchema, transitionMilestone);
}

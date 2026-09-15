/**
 * POST /api/projects/:projectId/transitions — fire a project lifecycle event.
 *
 * Body: `{ event, expectedStatus?, params? }`. The caller is always a HUMAN
 * actor built from the session; SYSTEM, WEBHOOK and AI transitions are not
 * reachable over HTTP. The state machine, RBAC, ownership, contextual rules,
 * idempotency and audit are all the lifecycle service's.
 */

import { handleTransitionRequest } from '../../../../../lib/http/lifecycle';
import { projectTransitionSchema } from '../../../../../lib/validation/lifecycle';
import { transitionProject } from '../../../../../services/lifecycle';

interface RouteParams {
  readonly params: Promise<{ projectId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { projectId } = await params;
  return handleTransitionRequest(request, projectId, projectTransitionSchema, transitionProject);
}

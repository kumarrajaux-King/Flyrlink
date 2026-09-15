/**
 * POST /api/contracts/:contractId/transitions — fire a contract lifecycle event.
 *
 * Body: `{ event, expectedStatus?, params? }`. The caller is always a HUMAN
 * actor built from the session; SYSTEM, WEBHOOK and AI transitions are not
 * reachable over HTTP. The state machine, RBAC, ownership, contextual rules,
 * idempotency and audit are all the lifecycle service's.
 */

import { handleTransitionRequest } from '../../../../../lib/http/lifecycle';
import { contractTransitionSchema } from '../../../../../lib/validation/lifecycle';
import { transitionContract } from '../../../../../services/lifecycle';

interface RouteParams {
  readonly params: Promise<{ contractId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { contractId } = await params;
  return handleTransitionRequest(request, contractId, contractTransitionSchema, transitionContract);
}

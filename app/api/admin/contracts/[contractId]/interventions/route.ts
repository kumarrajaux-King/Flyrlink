/**
 * POST /api/admin/contracts/:contractId/interventions — a governed administrative
 * contract transition (TERMINATE, CANCEL, START, CLOSE, RESOLVE_DISPUTE, …),
 * decided by the Phase 6 contract lifecycle.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { contractInterventionSchema } from '../../../../../../lib/validation/admin';
import { interveneInLifecycle } from '../../../../../../services/admin/intervention-service';

interface RouteParams {
  readonly params: Promise<{ contractId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { contractId } = await params;
  return handleAdminMutation(request, contractInterventionSchema, (actor, body, context) =>
    interveneInLifecycle({
      entityType: 'Contract',
      entityId: contractId,
      event: body.event,
      actor,
      reason: body.reason,
      confirm: body.confirm,
      expectedStatus: body.expectedStatus,
      params: body.params,
      context,
    }),
  );
}

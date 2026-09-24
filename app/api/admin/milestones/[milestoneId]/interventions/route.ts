/**
 * POST /api/admin/milestones/:milestoneId/interventions — a governed
 * administrative milestone transition (CANCEL_FUNDED, APPROVE, RESOLVE_DISPUTE,
 * …), decided by the Phase 6 milestone lifecycle.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { milestoneInterventionSchema } from '../../../../../../lib/validation/admin';
import { interveneInLifecycle } from '../../../../../../services/admin/intervention-service';

interface RouteParams {
  readonly params: Promise<{ milestoneId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { milestoneId } = await params;
  return handleAdminMutation(request, milestoneInterventionSchema, (actor, body, context) =>
    interveneInLifecycle({
      entityType: 'Milestone',
      entityId: milestoneId,
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

/**
 * POST /api/admin/projects/:projectId/interventions — a governed administrative
 * project transition (SUSPEND, RESUME, CANCEL, MARK_AT_RISK, …).
 *
 * The Phase 6 project lifecycle decides the transition; this endpoint adds the
 * reason, confirmation, conflict-of-interest check and intervention audit.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { projectInterventionSchema } from '../../../../../../lib/validation/admin';
import { interveneInLifecycle } from '../../../../../../services/admin/intervention-service';

interface RouteParams {
  readonly params: Promise<{ projectId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { projectId } = await params;
  return handleAdminMutation(request, projectInterventionSchema, (actor, body, context) =>
    interveneInLifecycle({
      entityType: 'Project',
      entityId: projectId,
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

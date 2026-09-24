/**
 * POST /api/admin/disputes/:disputeId/resolution — decide a dispute.
 *
 * HIGH risk: notes, `confirm: true` and the dispute's `expectedStatus`. The
 * decision is the Phase 6 RESOLVE_DISPUTE event on the frozen record; no award
 * amounts are accepted.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { disputeResolutionSchema } from '../../../../../../lib/validation/admin';
import { resolveDispute } from '../../../../../../services/admin/dispute-service';

interface RouteParams {
  readonly params: Promise<{ disputeId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { disputeId } = await params;
  return handleAdminMutation(request, disputeResolutionSchema, (actor, body, context) =>
    resolveDispute({
      actor,
      disputeId,
      resolution: body.resolution,
      notes: body.notes,
      closeProject: body.closeProject,
      confirm: body.confirm,
      expectedStatus: body.expectedStatus,
      context,
    }),
  );
}

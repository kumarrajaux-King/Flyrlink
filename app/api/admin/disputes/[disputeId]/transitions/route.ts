/**
 * POST /api/admin/disputes/:disputeId/transitions — triage: BEGIN_REVIEW,
 * REQUEST_EVIDENCE, RESUME_REVIEW, ESCALATE, RETURN_TO_REVIEW. Triage never
 * resolves a dispute.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { disputeTriageSchema } from '../../../../../../lib/validation/admin';
import { triageDispute } from '../../../../../../services/admin/dispute-service';

interface RouteParams {
  readonly params: Promise<{ disputeId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { disputeId } = await params;
  return handleAdminMutation(request, disputeTriageSchema, (actor, body, context) =>
    triageDispute({
      entityId: disputeId,
      event: body.event,
      actor,
      reason: body.reason,
      confirm: body.confirm,
      expectedStatus: body.expectedStatus,
      context,
    }),
  );
}

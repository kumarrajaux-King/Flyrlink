/**
 * POST /api/admin/verifications/:verificationId/transitions — START_REVIEW,
 * REQUEST_INFORMATION, APPROVE, REJECT or REVOKE.
 *
 * Human-only. APPROVE, REJECT and REVOKE are HIGH risk and must be confirmed;
 * approving a case with AI flags needs `params.acknowledgeAiFlags`.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { verificationTransitionSchema } from '../../../../../../lib/validation/admin';
import { transitionVerification } from '../../../../../../services/admin/verification-service';

interface RouteParams {
  readonly params: Promise<{ verificationId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { verificationId } = await params;
  return handleAdminMutation(request, verificationTransitionSchema, (actor, body, context) =>
    transitionVerification({
      entityId: verificationId,
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

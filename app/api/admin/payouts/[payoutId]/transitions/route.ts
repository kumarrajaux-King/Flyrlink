/**
 * POST /api/admin/payouts/:payoutId/transitions — APPROVE, HOLD, RELEASE_HOLD or
 * CANCEL (`payout:approve:any`, MFA). None of these moves money; processing is
 * provider-attested.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { payoutDecisionSchema } from '../../../../../../lib/validation/admin';
import { transitionPayout } from '../../../../../../services/admin/finance-service';

interface RouteParams {
  readonly params: Promise<{ payoutId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { payoutId } = await params;
  return handleAdminMutation(request, payoutDecisionSchema, (actor, body, context) =>
    transitionPayout({
      entityId: payoutId,
      event: body.event,
      actor,
      reason: body.reason,
      confirm: body.confirm,
      expectedStatus: body.expectedStatus,
      context,
    }),
  );
}

/**
 * POST /api/admin/payments/:paymentId/interventions — RELEASE, REQUEST_REFUND
 * or REJECT_REFUND, decided by the Phase 6 payment lifecycle.
 *
 * Provider truth (capture, refund confirmation, chargeback) is webhook-only and
 * cannot be sent here.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { paymentInterventionSchema } from '../../../../../../lib/validation/admin';
import { interveneInLifecycle } from '../../../../../../services/admin/intervention-service';

interface RouteParams {
  readonly params: Promise<{ paymentId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { paymentId } = await params;
  return handleAdminMutation(request, paymentInterventionSchema, (actor, body, context) =>
    interveneInLifecycle({
      entityType: 'Payment',
      entityId: paymentId,
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

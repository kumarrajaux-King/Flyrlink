/**
 * POST /api/payments/:paymentId/transitions — fire a payment lifecycle event.
 *
 * Body: `{ event, expectedStatus?, confirm?, params? }`. A caller acting on
 * platform authority must justify and confirm a HIGH or CRITICAL event. The caller is always a HUMAN
 * actor built from the session; SYSTEM, WEBHOOK and AI transitions are not
 * reachable over HTTP. The state machine, RBAC, ownership, contextual rules,
 * idempotency and audit are all the lifecycle service's.
 *
 * Payment truth never comes from here. The events that record what the
 * provider did — capture, refund, chargeback — are WEBHOOK-only, so posting
 * one to this route is refused (403) and audited.
 */

import { PAYMENT_MACHINE } from '../../../../../domain/payment/state-machine';
import { handleTransitionRequest } from '../../../../../lib/http/lifecycle';
import { paymentTransitionSchema } from '../../../../../lib/validation/lifecycle';
import { transitionPayment } from '../../../../../services/lifecycle';

interface RouteParams {
  readonly params: Promise<{ paymentId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { paymentId } = await params;
  return handleTransitionRequest(request, paymentId, paymentTransitionSchema, transitionPayment, PAYMENT_MACHINE);
}

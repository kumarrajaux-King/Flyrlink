/**
 * GET /api/admin/payments/:paymentId — one payment with attempts, webhook
 * confirmation, refunds and transactions (ledger entries for ledger readers).
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { emptyQuerySchema } from '../../../../../lib/validation/admin';
import { getPayment } from '../../../../../services/admin/finance-service';

interface RouteParams {
  readonly params: Promise<{ paymentId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { paymentId } = await params;
  return handleAdminRead(request, emptyQuerySchema, (actor) => getPayment({ actor, paymentId }), 'payment');
}

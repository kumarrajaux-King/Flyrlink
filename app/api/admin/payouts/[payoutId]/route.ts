/**
 * GET /api/admin/payouts/:payoutId — one payout with items, approval readiness,
 * available decisions and decision history.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { emptyQuerySchema } from '../../../../../lib/validation/admin';
import { getPayout } from '../../../../../services/admin/finance-service';

interface RouteParams {
  readonly params: Promise<{ payoutId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { payoutId } = await params;
  return handleAdminRead(request, emptyQuerySchema, (actor) => getPayout({ actor, payoutId }), 'payout');
}

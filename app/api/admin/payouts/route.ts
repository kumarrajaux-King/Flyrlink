/**
 * GET /api/admin/payouts — payout oversight list (`payout:read:any`).
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { payoutListQuerySchema } from '../../../../lib/validation/admin';
import { listPayouts } from '../../../../services/admin/finance-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, payoutListQuerySchema, (actor, query) => listPayouts({ actor, ...query }));
}

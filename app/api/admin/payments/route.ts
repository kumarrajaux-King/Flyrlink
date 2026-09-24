/**
 * GET /api/admin/payments — payment oversight list (`payment:read:any`). Read-only.
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { paymentListQuerySchema } from '../../../../lib/validation/admin';
import { listPayments } from '../../../../services/admin/finance-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, paymentListQuerySchema, (actor, query) => listPayments({ actor, ...query }));
}

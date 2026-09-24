/**
 * GET /api/admin/refunds — refund records (`payment:read:any`). Read-only.
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { refundListQuerySchema } from '../../../../lib/validation/admin';
import { listRefunds } from '../../../../services/admin/finance-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, refundListQuerySchema, (actor, query) => listRefunds({ actor, ...query }));
}

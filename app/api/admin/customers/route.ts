/**
 * GET /api/admin/customers — search and list customers (`customer:read:any`).
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { customerListQuerySchema } from '../../../../lib/validation/admin';
import { listCustomers } from '../../../../services/admin/people-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, customerListQuerySchema, (actor, query) => listCustomers({ actor, ...query }));
}

/**
 * GET /api/admin/customers/:customerId — one customer with project, contract and
 * dispute counts.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { emptyQuerySchema } from '../../../../../lib/validation/admin';
import { getCustomer } from '../../../../../services/admin/people-service';

interface RouteParams {
  readonly params: Promise<{ customerId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { customerId } = await params;
  return handleAdminRead(request, emptyQuerySchema, (actor) => getCustomer({ actor, customerId }), 'customer');
}

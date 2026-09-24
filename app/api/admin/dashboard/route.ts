/**
 * GET /api/admin/dashboard — operational counts, each section scoped to the
 * caller's own capabilities (STEP 01 §9.1).
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { emptyQuerySchema } from '../../../../lib/validation/admin';
import { getDashboard } from '../../../../services/admin/dashboard-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, emptyQuerySchema, (actor) => getDashboard({ actor }));
}

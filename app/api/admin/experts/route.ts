/**
 * GET /api/admin/experts — search and list experts with account data
 * (`expert:read:any` and `user:read:any`).
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { expertListQuerySchema } from '../../../../lib/validation/admin';
import { listExperts } from '../../../../services/admin/people-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, expertListQuerySchema, (actor, query) => listExperts({ actor, ...query }));
}

/**
 * GET /api/admin/users — search and list accounts (`user:read:any`).
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { userListQuerySchema } from '../../../../lib/validation/admin';
import { listUsers } from '../../../../services/admin/people-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, userListQuerySchema, (actor, query) => listUsers({ actor, ...query }));
}

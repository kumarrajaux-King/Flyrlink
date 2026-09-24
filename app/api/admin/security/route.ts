/**
 * GET /api/admin/security — the RBAC matrix, MFA policy, privileged accounts and
 * recent security events (`config:read:any` and `user:read:any`). Read-only.
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { emptyQuerySchema } from '../../../../lib/validation/admin';
import { getSecurityOverview } from '../../../../services/admin/security-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, emptyQuerySchema, (actor) => getSecurityOverview({ actor }));
}

/**
 * GET /api/admin/contracts — contract oversight list (`contract:read:any`).
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { contractListQuerySchema } from '../../../../lib/validation/admin';
import { listContracts } from '../../../../services/admin/oversight-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, contractListQuerySchema, (actor, query) => listContracts({ actor, ...query }));
}

/**
 * GET /api/admin/disputes — the dispute queue (`dispute:read:any`).
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { disputeListQuerySchema } from '../../../../lib/validation/admin';
import { listDisputes } from '../../../../services/admin/dispute-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, disputeListQuerySchema, (actor, query) => listDisputes({ actor, ...query }));
}

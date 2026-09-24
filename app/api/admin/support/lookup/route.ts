/**
 * GET /api/admin/support/lookup?q= — find the account, project, contract or
 * dispute a support request is about (`ticket:read:any`). Read-only.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { supportLookupQuerySchema } from '../../../../../lib/validation/admin';
import { supportLookup } from '../../../../../services/admin/support-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, supportLookupQuerySchema, (actor, query) => supportLookup({ actor, q: query.q }));
}

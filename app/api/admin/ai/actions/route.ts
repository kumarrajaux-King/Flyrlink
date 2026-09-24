/**
 * GET /api/admin/ai/actions — every tool call agents attempted, with its policy
 * decision and human approval (`ai:read:any`). Read-only.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { aiActionListQuerySchema } from '../../../../../lib/validation/admin';
import { listAiActions } from '../../../../../services/admin/ai-operations-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, aiActionListQuerySchema, (actor, { failedOnly, ...query }) =>
    listAiActions({ actor, ...query, failedOnly: failedOnly === 'true' }),
  );
}

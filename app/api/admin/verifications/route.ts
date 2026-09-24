/**
 * GET /api/admin/verifications — the verification queue, oldest first
 * (`expert:verify:any`).
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { verificationQueueQuerySchema } from '../../../../lib/validation/admin';
import { listVerificationQueue } from '../../../../services/admin/verification-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, verificationQueueQuerySchema, (actor, query) =>
    listVerificationQueue({ actor, ...query }),
  );
}

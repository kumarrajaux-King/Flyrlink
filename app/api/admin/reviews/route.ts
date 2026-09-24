/**
 * GET /api/admin/reviews — the moderation queue (`review:moderate:any`).
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { reviewListQuerySchema } from '../../../../lib/validation/admin';
import { listReviewsForModeration } from '../../../../services/admin/review-moderation-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, reviewListQuerySchema, (actor, query) =>
    listReviewsForModeration({ actor, ...query }),
  );
}

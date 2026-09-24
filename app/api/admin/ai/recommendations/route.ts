/**
 * GET /api/admin/ai/recommendations — recommendations with scores, evidence and
 * human decisions (`ai:read:any`). Read-only.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { aiRecommendationListQuerySchema } from '../../../../../lib/validation/admin';
import { listAiRecommendations } from '../../../../../services/admin/ai-operations-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, aiRecommendationListQuerySchema, (actor, query) =>
    listAiRecommendations({ actor, ...query }),
  );
}

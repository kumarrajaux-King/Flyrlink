/**
 * POST /api/admin/reviews/:reviewId/transitions — TAKE_FOR_MODERATION, PUBLISH,
 * HIDE, REINSTATE or REJECT. Visibility only; content is never edited.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { reviewModerationSchema } from '../../../../../../lib/validation/admin';
import { moderateReview } from '../../../../../../services/admin/review-moderation-service';

interface RouteParams {
  readonly params: Promise<{ reviewId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { reviewId } = await params;
  return handleAdminMutation(request, reviewModerationSchema, (actor, body, context) =>
    moderateReview({
      entityId: reviewId,
      event: body.event,
      actor,
      reason: body.reason,
      confirm: body.confirm,
      expectedStatus: body.expectedStatus,
      context,
    }),
  );
}

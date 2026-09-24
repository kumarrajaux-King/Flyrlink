/**
 * DELETE /api/admin/users/:userId/lockout — clear a login lockout early.
 * Needs a reason.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { reasonOnlySchema } from '../../../../../../lib/validation/admin';
import { clearUserLockout } from '../../../../../../services/admin/people-service';

interface RouteParams {
  readonly params: Promise<{ userId: string }>;
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const { userId } = await params;
  return handleAdminMutation(request, reasonOnlySchema, (actor, body, context) =>
    clearUserLockout({ actor, userId, reason: body.reason, context }),
  );
}

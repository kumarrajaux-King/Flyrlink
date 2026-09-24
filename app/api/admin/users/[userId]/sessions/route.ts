/**
 * DELETE /api/admin/users/:userId/sessions — sign an account out everywhere.
 * Needs a reason.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { reasonOnlySchema } from '../../../../../../lib/validation/admin';
import { revokeUserSessions } from '../../../../../../services/admin/people-service';

interface RouteParams {
  readonly params: Promise<{ userId: string }>;
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const { userId } = await params;
  return handleAdminMutation(request, reasonOnlySchema, (actor, body, context) =>
    revokeUserSessions({ actor, userId, reason: body.reason, context }),
  );
}

/**
 * POST /api/admin/users/:userId/status — SUSPEND or REINSTATE an account.
 *
 * HIGH risk: a reason, `confirm: true` and the `expectedStatus` reviewed. Only a
 * super administrator may act on a privileged account; nobody on their own.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { accountTransitionSchema } from '../../../../../../lib/validation/admin';
import { transitionAccount } from '../../../../../../services/admin/people-service';

interface RouteParams {
  readonly params: Promise<{ userId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { userId } = await params;
  return handleAdminMutation(request, accountTransitionSchema, (actor, body, context) =>
    transitionAccount({
      entityId: userId,
      event: body.event,
      actor,
      reason: body.reason,
      confirm: body.confirm,
      expectedStatus: body.expectedStatus,
      context,
    }),
  );
}

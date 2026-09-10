/**
 * POST /api/auth/password/change
 *
 * Requires an authenticated session AND the current password, so a stolen
 * session alone cannot lock the owner out. Other sessions are revoked; the
 * caller's survives.
 */

import { parseJsonBody, requestContext, requireSession } from '../../../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../../../lib/http/response';
import { changePasswordSchema } from '../../../../../lib/validation/auth';
import { changePassword } from '../../../../../services/auth/account-service';

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const input = await parseJsonBody(request, changePasswordSchema);

    const outcome = await changePassword({
      userId: session.actor.userId,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      currentSessionId: session.sessionId,
      context: requestContext(request, requestId),
    });

    if (outcome === 'WRONG_PASSWORD') {
      return fail('INVALID_CREDENTIALS', 'Your current password is incorrect.', 403, requestId);
    }
    if (outcome === 'USER_NOT_FOUND') {
      return fail('NOT_FOUND', 'Account not found.', 404, requestId);
    }

    return ok({ changed: true }, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

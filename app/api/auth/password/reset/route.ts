/**
 * POST /api/auth/password/reset
 *
 * Completes a reset. Every session is revoked, including the caller's, and the
 * cookie is cleared — a reset is the recovery path for a compromised account, so
 * any session an attacker holds must die with it.
 */

import { parseJsonBody, requestContext } from '../../../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../../../lib/http/response';
import { serializeClearedSessionCookie } from '../../../../../lib/http/session-cookie';
import { resetPasswordSchema } from '../../../../../lib/validation/auth';
import { resetPassword } from '../../../../../services/auth/account-service';

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const input = await parseJsonBody(request, resetPasswordSchema);

    const outcome = await resetPassword({
      token: input.token,
      newPassword: input.password,
      context: requestContext(request, requestId),
    });

    if (outcome !== 'RESET') {
      return fail(
        'TOKEN_INVALID_OR_EXPIRED',
        'This reset link is invalid or has expired.',
        400,
        requestId,
      );
    }

    return ok({ reset: true }, requestId, 200, {
      'set-cookie': serializeClearedSessionCookie(),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

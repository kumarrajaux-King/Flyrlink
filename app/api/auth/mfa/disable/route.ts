/**
 * POST /api/auth/mfa/disable
 *
 * Requires the password AND a valid code. Refused for a user holding an
 * MFA-required role, so a privileged account cannot downgrade its own security.
 */

import { parseJsonBody, requestContext, requireSession } from '../../../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../../../lib/http/response';
import { serializeClearedSessionCookie } from '../../../../../lib/http/session-cookie';
import { disableMfaSchema } from '../../../../../lib/validation/auth';
import { disableMfa } from '../../../../../services/auth/mfa-service';

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const input = await parseJsonBody(request, disableMfaSchema);

    const outcome = await disableMfa({
      userId: session.actor.userId,
      currentPassword: input.currentPassword,
      code: input.code,
      context: requestContext(request, requestId),
    });

    switch (outcome) {
      case 'DISABLED':
        return ok({ disabled: true }, requestId, 200, {
          'set-cookie': serializeClearedSessionCookie(),
        });
      case 'REQUIRED_BY_ROLE':
        return fail(
          'MFA_REQUIRED_BY_ROLE',
          'Your role requires multi-factor authentication, so it cannot be disabled.',
          409,
          requestId,
        );
      case 'WRONG_PASSWORD':
        return fail('INVALID_CREDENTIALS', 'Your password is incorrect.', 403, requestId);
      case 'INVALID_CODE':
        return fail('MFA_CODE_INVALID', 'That code is not correct.', 400, requestId);
      default:
        return fail(
          'MFA_NOT_ENABLED',
          'Multi-factor authentication is not enabled.',
          409,
          requestId,
        );
    }
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

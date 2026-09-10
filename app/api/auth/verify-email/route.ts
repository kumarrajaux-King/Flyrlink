/**
 * POST /api/auth/verify-email
 *
 * Consumes an email-verification token and promotes the account to ACTIVE.
 */

import { parseJsonBody, requestContext } from '../../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../../lib/http/response';
import { verifyEmailSchema } from '../../../../lib/validation/auth';
import { verifyEmail } from '../../../../services/auth/account-service';

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const input = await parseJsonBody(request, verifyEmailSchema);
    const outcome = await verifyEmail({
      token: input.token,
      context: requestContext(request, requestId),
    });

    switch (outcome) {
      case 'VERIFIED':
        return ok({ verified: true }, requestId);
      case 'ALREADY_VERIFIED':
        // Not an error: a user clicking the link twice has the outcome they wanted.
        return ok({ verified: true, alreadyVerified: true }, requestId);
      default:
        return fail(
          'TOKEN_INVALID_OR_EXPIRED',
          'This verification link is invalid or has expired.',
          400,
          requestId,
        );
    }
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

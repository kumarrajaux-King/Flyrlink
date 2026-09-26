/**
 * POST /api/auth/password/forgot
 *
 * Always 202 with the same body, so the endpoint cannot reveal which addresses
 * are registered. The link is emailed and never returned in the response.
 */

import { appUrl, emailService } from '../../../../../lib/email/email-service';
import { parseJsonBody, requestContext } from '../../../../../lib/http/auth-context';
import { errorResponse, ok, resolveRequestId } from '../../../../../lib/http/response';
import { requestPasswordResetSchema } from '../../../../../lib/validation/auth';
import { requestPasswordReset } from '../../../../../services/auth/account-service';

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const input = await parseJsonBody(request, requestPasswordResetSchema);

    const result = await requestPasswordReset({
      email: input.email,
      context: requestContext(request, requestId),
    });

    if (result.resetToken) {
      await emailService().sendPasswordReset({
        to: input.email,
        actionUrl: appUrl(`/reset-password?token=${result.resetToken}`),
      });
    }

    return ok(
      { accepted: true, message: 'If that address has an account, a reset link is on its way.' },
      requestId,
      202,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

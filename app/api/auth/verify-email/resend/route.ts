/**
 * POST /api/auth/verify-email/resend
 *
 * Issues a fresh verification link. Always 202 with the same body, whether the
 * address is registered, already verified, or inside the resend cooldown — the
 * enumeration rule the rest of the auth surface follows.
 *
 * Without this, letting a 24-hour verification link lapse was a dead end: the
 * account cannot sign in, and registering again fails on the unique email.
 */

import { appUrl, emailService } from '../../../../../lib/email/email-service';
import { parseJsonBody, requestContext } from '../../../../../lib/http/auth-context';
import { errorResponse, ok, resolveRequestId } from '../../../../../lib/http/response';
import { resendVerificationSchema } from '../../../../../lib/validation/auth';
import { resendVerification } from '../../../../../services/auth/account-service';

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const input = await parseJsonBody(request, resendVerificationSchema);

    const result = await resendVerification({
      email: input.email,
      context: requestContext(request, requestId),
    });

    if (result.verificationToken) {
      await emailService().sendVerificationOTP({
        to: input.email,
        actionUrl: appUrl(`/verify-email?token=${result.verificationToken}`),
      });
    }

    return ok(
      { accepted: true, message: 'If that address needs verifying, a new link is on its way.' },
      requestId,
      202,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

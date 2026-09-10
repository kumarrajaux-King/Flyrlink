/**
 * POST /api/auth/register
 *
 * Always responds 202 with the same body, whether or not the address was already
 * registered. The real signal goes to the mailbox, so this endpoint cannot be
 * used to enumerate accounts.
 */

import { appUrl, sendAuthEmail } from '../../../../lib/email/auth-email';
import { parseJsonBody, requestContext } from '../../../../lib/http/auth-context';
import { errorResponse, ok, resolveRequestId } from '../../../../lib/http/response';
import { registerSchema } from '../../../../lib/validation/auth';
import { registerUser } from '../../../../services/auth/account-service';

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const input = await parseJsonBody(request, registerSchema);

    const result = await registerUser({
      email: input.email,
      password: input.password,
      fullName: input.fullName,
      accountType: input.accountType,
      context: requestContext(request, requestId),
    });

    if (result.verificationToken) {
      await sendAuthEmail({
        to: input.email,
        kind: 'EMAIL_VERIFICATION',
        actionUrl: appUrl(`/verify-email?token=${result.verificationToken}`),
      });
    } else {
      // The address already exists. Tell the genuine owner, not the caller.
      await sendAuthEmail({ to: input.email, kind: 'DUPLICATE_REGISTRATION' });
    }

    // Deliberately does not echo the user id: that too would be an enumeration signal.
    return ok(
      { accepted: true, message: 'Check your email to verify your address.' },
      requestId,
      202,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

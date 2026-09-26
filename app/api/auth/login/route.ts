/**
 * POST /api/auth/login
 *
 * Sets the session cookie on success. When the session is not MFA-cleared the
 * cookie is still set — `authorize` withholds privileged work until
 * `/api/auth/mfa/verify` succeeds. The response says which state the caller is
 * in so the UI knows whether to show the challenge, or send an administrator
 * who never enrolled a second factor to set one up first.
 */

import { parseJsonBody, requestContext } from '../../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../../lib/http/response';
import { serializeSessionCookie } from '../../../../lib/http/session-cookie';
import { loginSchema } from '../../../../lib/validation/auth';
import { login } from '../../../../services/auth/login-service';

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const input = await parseJsonBody(request, loginSchema);

    const outcome = await login({
      email: input.email,
      password: input.password,
      context: requestContext(request, requestId),
    });

    switch (outcome.result) {
      case 'SUCCESS':
      case 'MFA_REQUIRED':
      case 'MFA_ENROLLMENT_REQUIRED': {
        const cookie = serializeSessionCookie(
          outcome.session.rawToken,
          outcome.session.expiresAt,
        );
        return ok(
          {
            authenticated: true,
            // Un-cleared either way: one needs a code, the other needs a factor
            // to produce codes with.
            mfaRequired: outcome.result !== 'SUCCESS',
            mfaEnrollmentRequired: outcome.result === 'MFA_ENROLLMENT_REQUIRED',
            expiresAt: outcome.session.expiresAt.toISOString(),
          },
          requestId,
          200,
          { 'set-cookie': cookie },
        );
      }

      case 'ACCOUNT_LOCKED':
        // Safe to disclose: the caller has already demonstrated repeated failed
        // attempts against this address, so this reveals nothing new, and telling
        // them to wait is far better than an endless "invalid credentials" loop.
        return fail(
          'ACCOUNT_LOCKED',
          'Too many failed attempts. Try again later.',
          423,
          requestId,
        );

      case 'INVALID_CREDENTIALS':
      default:
        return fail('INVALID_CREDENTIALS', 'Email or password is incorrect.', 401, requestId);
    }
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

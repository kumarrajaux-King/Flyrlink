/**
 * POST /api/auth/mfa/verify
 *
 * Completes the MFA challenge for the current session, with either a TOTP code or
 * a single-use backup code.
 *
 * A success reissues the session token, because clearing MFA raises what the
 * session may do and the identifier must not survive that change. The new
 * token goes back in the cookie here; without that the person is signed out.
 */

import { parseJsonBody, requestContext, requireSession } from '../../../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../../../lib/http/response';
import { serializeSessionCookie } from '../../../../../lib/http/session-cookie';
import { verifyMfaSchema } from '../../../../../lib/validation/auth';
import { verifyMfaChallenge } from '../../../../../services/auth/mfa-service';

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const input = await parseJsonBody(request, verifyMfaSchema);

    const outcome = await verifyMfaChallenge({
      userId: session.actor.userId,
      sessionId: session.sessionId,
      code: input.code,
      backupCode: input.backupCode,
      context: requestContext(request, requestId),
    });

    if (outcome.result === 'MFA_NOT_ENABLED') {
      return fail(
        'MFA_NOT_ENABLED',
        'Multi-factor authentication is not enabled.',
        409,
        requestId,
      );
    }
    if (outcome.result === 'LOCKED') {
      // Safe to disclose: the caller has already demonstrated repeated failures
      // against this account, so it reveals nothing they did not just do.
      return fail(
        'ACCOUNT_LOCKED',
        'Too many incorrect codes. Try again later.',
        423,
        requestId,
      );
    }
    if (outcome.result === 'INVALID') {
      return fail(
        'MFA_CODE_INVALID',
        'That code is not correct or has already been used.',
        401,
        requestId,
      );
    }

    return ok(
      { mfaSatisfied: true, usedBackupCode: outcome.usedBackupCode },
      requestId,
      200,
      { 'set-cookie': serializeSessionCookie(outcome.rawToken, outcome.expiresAt) },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

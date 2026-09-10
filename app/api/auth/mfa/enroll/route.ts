/**
 * POST  /api/auth/mfa/enroll  — phase 1: issue a secret (MFA not yet active)
 * PATCH /api/auth/mfa/enroll  — phase 2: prove a code, then enable
 *
 * Two phases so a user cannot enable MFA with a secret their authenticator never
 * received and lock themselves out of a privileged account.
 */

import { parseJsonBody, requestContext, requireSession } from '../../../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../../../lib/http/response';
import { serializeClearedSessionCookie } from '../../../../../lib/http/session-cookie';
import { enrollMfaSchema } from '../../../../../lib/validation/auth';
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
} from '../../../../../services/auth/mfa-service';

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);

    const start = await beginMfaEnrollment({
      userId: session.actor.userId,
      context: requestContext(request, requestId),
    });

    if (!start) {
      return fail(
        'MFA_ALREADY_ENABLED',
        'Multi-factor authentication is already enabled.',
        409,
        requestId,
      );
    }

    // The secret is returned once, to be rendered as a QR code. It is not
    // retrievable again after this call.
    return ok({ secret: start.secret, otpauthUri: start.otpauthUri }, requestId, 201);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const input = await parseJsonBody(request, enrollMfaSchema);

    const outcome = await confirmMfaEnrollment({
      userId: session.actor.userId,
      code: input.code,
      context: requestContext(request, requestId),
    });

    if (outcome.result === 'NOT_ENROLLING') {
      return fail('MFA_NOT_ENROLLING', 'Start MFA enrollment first.', 409, requestId);
    }
    if (outcome.result === 'INVALID_CODE') {
      return fail('MFA_CODE_INVALID', 'That code is not correct.', 400, requestId);
    }

    // Enabling MFA revoked every session, including this one, so clear the cookie
    // and make the client sign in again through the challenge.
    return ok(
      {
        enabled: true,
        backupCodes: outcome.backupCodes,
        message: 'Save these backup codes now. They are shown only once.',
      },
      requestId,
      200,
      { 'set-cookie': serializeClearedSessionCookie() },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

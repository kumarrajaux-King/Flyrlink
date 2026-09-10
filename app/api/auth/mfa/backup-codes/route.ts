/**
 * GET  /api/auth/mfa/backup-codes  — how many remain unused
 * POST /api/auth/mfa/backup-codes  — issue a fresh set, invalidating the old one
 */

import { requestContext, requireSession } from '../../../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../../../lib/http/response';
import {
  countUnusedBackupCodes,
  regenerateBackupCodes,
} from '../../../../../services/auth/mfa-service';

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    return ok({ remaining: await countUnusedBackupCodes(session.actor.userId) }, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);

    const codes = await regenerateBackupCodes({
      userId: session.actor.userId,
      context: requestContext(request, requestId),
    });

    if (!codes) {
      return fail(
        'MFA_NOT_ENABLED',
        'Multi-factor authentication is not enabled.',
        409,
        requestId,
      );
    }

    return ok(
      { backupCodes: codes, message: 'Save these now. They are shown only once.' },
      requestId,
      201,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

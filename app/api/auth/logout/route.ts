/**
 * POST /api/auth/logout
 *
 * Revokes the current session server-side and clears the cookie. Idempotent:
 * calling it without a session still returns 204, because a client trying to log
 * out should never be told it failed.
 */

import { getSession, requestContext } from '../../../../lib/http/auth-context';
import { errorResponse, resolveRequestId } from '../../../../lib/http/response';
import { serializeClearedSessionCookie } from '../../../../lib/http/session-cookie';
import { logout } from '../../../../services/auth/login-service';

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await getSession(request);
    if (session) {
      await logout({
        sessionId: session.sessionId,
        userId: session.actor.userId,
        context: requestContext(request, requestId),
      });
    }

    return new Response(null, {
      status: 204,
      headers: {
        'set-cookie': serializeClearedSessionCookie(),
        'x-request-id': requestId,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

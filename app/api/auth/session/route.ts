/**
 * GET /api/auth/session
 *
 * Returns the caller's own identity, roles and permissions. The permission list
 * is included so the UI can decide what to render — but it is advisory only:
 * every mutation re-checks server-side, so a tampered client gains nothing.
 */

import { getSession } from '../../../../lib/http/auth-context';
import { errorResponse, ok, resolveRequestId } from '../../../../lib/http/response';
import { permissionsForRoles } from '../../../../lib/authz/roles';

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await getSession(request);
    if (!session) {
      return ok({ authenticated: false }, requestId);
    }

    return ok(
      {
        authenticated: true,
        userId: session.actor.userId,
        roles: session.actor.roles,
        accountActive: session.actor.accountActive,
        mfaSatisfied: session.actor.mfaSatisfied,
        mfaChallengePending: session.mfaChallengePending,
        expiresAt: session.expiresAt.toISOString(),
        permissions: [...permissionsForRoles(session.actor.roles)].sort(),
      },
      requestId,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

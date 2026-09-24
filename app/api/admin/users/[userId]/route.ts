/**
 * GET /api/admin/users/:userId — one account: roles, standing, MFA and lockout
 * state, active sessions. Never credentials.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { emptyQuerySchema } from '../../../../../lib/validation/admin';
import { getUser } from '../../../../../services/admin/people-service';

interface RouteParams {
  readonly params: Promise<{ userId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { userId } = await params;
  return handleAdminRead(request, emptyQuerySchema, (actor) => getUser({ actor, userId }), 'account');
}

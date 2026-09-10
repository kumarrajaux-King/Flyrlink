/**
 * POST   /api/admin/users/:userId/roles  — assign a role
 * DELETE /api/admin/users/:userId/roles  — revoke a role
 *
 * SUPER_ADMIN only, and only with MFA satisfied. Both constraints are enforced
 * inside `role-service` rather than here, so the guarantee does not depend on
 * this handler remembering to check.
 */

import { parseJsonBody, requestContext, requireSession } from '../../../../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../../../../lib/http/response';
import { assignRoleSchema } from '../../../../../../lib/validation/auth';
import { assignRole, revokeRole, rolesForUser } from '../../../../../../services/auth/role-service';

interface RouteParams {
  readonly params: Promise<{ userId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const { userId } = await params;

    // Validate the path parameter alongside the body so a malformed id is a 422
    // rather than a database error.
    const input = await parseJsonBody(request, assignRoleSchema.partial({ userId: true }));
    const parsed = assignRoleSchema.parse({ userId, role: input.role });

    const outcome = await assignRole({
      actor: session.actor,
      userId: parsed.userId,
      role: parsed.role,
      context: requestContext(request, requestId),
    });

    if (outcome === 'USER_NOT_FOUND') {
      return fail('NOT_FOUND', 'That user does not exist.', 404, requestId);
    }

    return ok(
      { assigned: outcome === 'ASSIGNED', roles: await rolesForUser(parsed.userId) },
      requestId,
      outcome === 'ASSIGNED' ? 201 : 200,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const { userId } = await params;

    const input = await parseJsonBody(request, assignRoleSchema.partial({ userId: true }));
    const parsed = assignRoleSchema.parse({ userId, role: input.role });

    const outcome = await revokeRole({
      actor: session.actor,
      userId: parsed.userId,
      role: parsed.role,
      context: requestContext(request, requestId),
    });

    switch (outcome) {
      case 'REVOKED':
        return ok({ revoked: true, roles: await rolesForUser(parsed.userId) }, requestId);
      case 'NOT_ASSIGNED':
        return fail('ROLE_NOT_ASSIGNED', 'That user does not hold that role.', 409, requestId);
      case 'LAST_SUPER_ADMIN':
        // Refusing this is deliberate: removing the final SUPER_ADMIN would leave
        // nobody able to assign roles, with no in-product way to recover.
        return fail(
          'LAST_SUPER_ADMIN',
          'You cannot remove the last remaining super administrator.',
          409,
          requestId,
        );
      default:
        return fail('NOT_FOUND', 'That user does not exist.', 404, requestId);
    }
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

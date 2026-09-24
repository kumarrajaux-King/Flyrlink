/**
 * GET /api/admin/experts/:expertId — one expert. Verification cases are
 * included only for callers who may read them.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { emptyQuerySchema } from '../../../../../lib/validation/admin';
import { getExpert } from '../../../../../services/admin/people-service';

interface RouteParams {
  readonly params: Promise<{ expertId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { expertId } = await params;
  return handleAdminRead(request, emptyQuerySchema, (actor) => getExpert({ actor, expertId }), 'expert');
}

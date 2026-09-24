/**
 * GET /api/admin/milestones/:milestoneId — one milestone with deliverables, open
 * disputes, available interventions, and payments for callers who may read them.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { emptyQuerySchema } from '../../../../../lib/validation/admin';
import { getMilestone } from '../../../../../services/admin/oversight-service';

interface RouteParams {
  readonly params: Promise<{ milestoneId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { milestoneId } = await params;
  return handleAdminRead(request, emptyQuerySchema, (actor) => getMilestone({ actor, milestoneId }), 'milestone');
}

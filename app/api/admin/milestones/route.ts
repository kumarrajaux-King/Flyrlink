/**
 * GET /api/admin/milestones — milestone oversight list (`milestone:read:any`).
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { milestoneListQuerySchema } from '../../../../lib/validation/admin';
import { listMilestones } from '../../../../services/admin/oversight-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, milestoneListQuerySchema, (actor, query) => listMilestones({ actor, ...query }));
}

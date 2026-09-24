/**
 * GET /api/admin/projects — project oversight list (`project:read:any`).
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { projectListQuerySchema } from '../../../../lib/validation/admin';
import { listProjects } from '../../../../services/admin/oversight-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, projectListQuerySchema, (actor, query) => listProjects({ actor, ...query }));
}

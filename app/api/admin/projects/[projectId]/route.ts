/**
 * GET /api/admin/projects/:projectId — one project with its contracts,
 * assignments, milestone counts, open disputes and available interventions.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { emptyQuerySchema } from '../../../../../lib/validation/admin';
import { getProject } from '../../../../../services/admin/oversight-service';

interface RouteParams {
  readonly params: Promise<{ projectId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { projectId } = await params;
  return handleAdminRead(request, emptyQuerySchema, (actor) => getProject({ actor, projectId }), 'project');
}

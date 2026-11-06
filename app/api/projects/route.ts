/**
 * GET  /api/projects — the caller's own briefs, newest first.
 * POST /api/projects — create a brief as DRAFT.
 *
 * This is the entry point the intake flow needs. `source` is always
 * POSTED_PROJECT and `status` is always DRAFT: both are the server's to decide,
 * and a project's status only ever moves through the Phase 6 lifecycle engine
 * afterwards.
 */

import { prisma } from '../../../lib/db/client';
import { parseJsonBody, requestContext, requireSession } from '../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../lib/http/response';
import { parseQuery } from '../../../lib/validation/messaging';
import { createProjectSchema, projectListQuerySchema } from '../../../lib/validation/projects';
import { ProjectRejection, createProject, listProjects } from '../../../services/projects/project-service';

const REJECTION_HTTP: Record<ProjectRejection['code'], { status: number; code: string }> = {
  NOT_FOUND: { status: 404, code: 'NOT_FOUND' },
  NO_CUSTOMER_PROFILE: { status: 409, code: 'NO_CUSTOMER_PROFILE' },
  NOT_EDITABLE: { status: 409, code: 'PROJECT_NOT_EDITABLE' },
};

export function projectError(error: unknown, requestId: string): Response {
  if (error instanceof ProjectRejection) {
    const mapping = REJECTION_HTTP[error.code];
    return fail(mapping.code, error.message, mapping.status, requestId);
  }
  return errorResponse(error, requestId);
}

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  try {
    const session = await requireSession(request);
    const query = parseQuery(request.url, projectListQuerySchema);
    return ok(await listProjects(prisma, session.actor, query), requestId);
  } catch (error) {
    return projectError(error, requestId);
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  try {
    const session = await requireSession(request);
    const body = await parseJsonBody(request, createProjectSchema);
    const project = await createProject(prisma, session.actor, body, requestContext(request, requestId));
    return ok(project, requestId, 201);
  } catch (error) {
    return projectError(error, requestId);
  }
}

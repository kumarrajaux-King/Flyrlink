/**
 * GET   /api/projects/:id — one brief, with its requirements.
 * PATCH /api/projects/:id — edit it while it is still a draft.
 *
 * Reading goes through `authorize` with the project's own customer, so there is
 * no path that loads a project by id alone. Editing stops at DRAFT: after
 * submission the description is what the analysis and any recommendation were
 * produced against.
 */

import { prisma } from '../../../../lib/db/client';
import { parseJsonBody, requestContext, requireSession } from '../../../../lib/http/auth-context';
import { ok, resolveRequestId } from '../../../../lib/http/response';
import { updateProjectSchema } from '../../../../lib/validation/projects';
import { getProject, updateDraft } from '../../../../services/projects/project-service';
import { projectError } from '../route';

interface RouteParams {
  readonly params: Promise<{ projectId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const requestId = resolveRequestId(request);
  try {
    const session = await requireSession(request);
    const { projectId } = await params;
    return ok(await getProject(prisma, session.actor, projectId), requestId);
  } catch (error) {
    return projectError(error, requestId);
  }
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  const requestId = resolveRequestId(request);
  try {
    const session = await requireSession(request);
    const { projectId } = await params;
    const body = await parseJsonBody(request, updateProjectSchema);
    const updated = await updateDraft(
      prisma,
      session.actor,
      projectId,
      body,
      requestContext(request, requestId),
    );
    return ok(updated, requestId);
  } catch (error) {
    return projectError(error, requestId);
  }
}

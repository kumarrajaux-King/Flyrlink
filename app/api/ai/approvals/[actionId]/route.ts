/**
 * POST /api/ai/approvals/:actionId — approve or reject a held AI action.
 *
 * This is the only route through which a HIGH or CRITICAL action can ever
 * execute. The approving human becomes the acting identity, so the action runs
 * with their permissions and is audited against their name.
 */

import { parseJsonBody, requestContext, requireSession } from '../../../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../../../lib/http/response';
import { approvalDecisionSchema } from '../../../../../lib/validation/ai';
import { approveAction, rejectAction } from '../../../../../services/ai/approval-service';

interface RouteParams {
  readonly params: Promise<{ actionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const { actionId } = await params;
    const body = await parseJsonBody(request, approvalDecisionSchema);
    const context = requestContext(request, requestId);

    const outcome =
      body.decision === 'APPROVE'
        ? await approveAction({ actor: session.actor, actionId, context })
        : await rejectAction({
            actor: session.actor,
            actionId,
            reason: body.reason ?? 'Rejected by reviewer',
            context,
          });

    switch (outcome.result) {
      case 'EXECUTED':
        return ok({ executed: true, actionId: outcome.actionId, output: outcome.output }, requestId);
      case 'REJECTED':
        return ok({ rejected: true, actionId: outcome.actionId }, requestId);
      case 'NOT_FOUND':
        return fail('NOT_FOUND', 'No such AI action.', 404, requestId);
      case 'NOT_PENDING':
        return fail(
          'ACTION_NOT_PENDING',
          `This action is already ${outcome.currentStatus}.`,
          409,
          requestId,
        );
      case 'SUPER_ADMIN_REQUIRED':
        return fail(
          'FORBIDDEN_SUPER_ADMIN_REQUIRED',
          'A CRITICAL action requires a super administrator.',
          403,
          requestId,
        );
      case 'EXECUTION_FAILED':
        return fail('TOOL_EXECUTION_FAILED', outcome.message, 502, requestId);
      default:
        return fail('INTERNAL_ERROR', 'Unhandled approval outcome.', 500, requestId);
    }
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

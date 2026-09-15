/**
 * The HTTP boundary of the lifecycle services.
 *
 * Every transition route does the same three things, so they live here once:
 * authenticate, validate the body, and call the service as a HUMAN actor built
 * from the session. The route never decides anything about the transition —
 * that is the service's, and the response simply reports its outcome.
 */

import type {
  LifecycleRejectionCode,
  TransitionDenyReason,
  TransitionOutcome,
  TransitionParams,
  TransitionRequest,
} from '../../services/lifecycle';
import { parseJsonBody, requestContext, requireSession } from './auth-context';
import { errorResponse, fail, ok, resolveRequestId } from './response';

interface TransitionBody {
  readonly event: string;
  readonly expectedStatus?: string | undefined;
  readonly params?: TransitionParams | undefined;
}

const REJECTION_HTTP: Record<LifecycleRejectionCode, { readonly status: number; readonly code: string }> = {
  NOT_FOUND: { status: 404, code: 'NOT_FOUND' },
  UNKNOWN_EVENT: { status: 400, code: 'TRANSITION_UNKNOWN_EVENT' },
  INVALID_TRANSITION: { status: 409, code: 'TRANSITION_INVALID' },
  CONFLICT: { status: 409, code: 'TRANSITION_CONFLICT' },
  AI_NOT_PERMITTED: { status: 403, code: 'TRANSITION_AI_NOT_PERMITTED' },
  ACTOR_NOT_PERMITTED: { status: 403, code: 'TRANSITION_ACTOR_NOT_PERMITTED' },
  FORBIDDEN: { status: 403, code: 'FORBIDDEN_RESOURCE' },
  PRECONDITION_FAILED: { status: 422, code: 'TRANSITION_PRECONDITION_FAILED' },
  WEBHOOK_REJECTED: { status: 422, code: 'TRANSITION_WEBHOOK_REJECTED' },
};

/** Match the error codes STEP 4's AuthorizationError uses for the same denials. */
function forbiddenCode(reason: TransitionDenyReason | null): string {
  switch (reason) {
    case 'MFA_REQUIRED':
      return 'MFA_REQUIRED';
    case 'ACCOUNT_INACTIVE':
      return 'ACCOUNT_INACTIVE';
    case 'SUPER_ADMIN_REQUIRED':
      return 'FORBIDDEN_SUPER_ADMIN_REQUIRED';
    default:
      return 'FORBIDDEN_RESOURCE';
  }
}

export function transitionResponse(outcome: TransitionOutcome, requestId: string): Response {
  switch (outcome.result) {
    case 'APPLIED':
      return ok(
        {
          result: outcome.result,
          entityType: outcome.entityType,
          entityId: outcome.entityId,
          event: outcome.event,
          from: outcome.from,
          to: outcome.to,
          cascades: outcome.cascades,
        },
        requestId,
      );
    case 'NO_OP':
      // An idempotent repeat is a success: the requested state holds.
      return ok(
        {
          result: outcome.result,
          entityType: outcome.entityType,
          entityId: outcome.entityId,
          event: outcome.event,
          status: outcome.status,
        },
        requestId,
      );
    default: {
      const mapping = REJECTION_HTTP[outcome.code];
      const code = outcome.code === 'FORBIDDEN' ? forbiddenCode(outcome.denyReason) : mapping.code;
      return fail(code, outcome.message, mapping.status, requestId);
    }
  }
}

/** Shared POST handler for `/api/{entity}/:id/transitions`. */
export async function handleTransitionRequest(
  request: Request,
  entityId: string,
  schema: { parse: (input: unknown) => TransitionBody },
  transition: (request: TransitionRequest) => Promise<TransitionOutcome>,
): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const body = await parseJsonBody(request, schema);

    const outcome = await transition({
      entityId,
      event: body.event,
      // Always HUMAN. SYSTEM, WEBHOOK and AI_AGENT actors are never built from a request.
      actor: { kind: 'HUMAN', actor: session.actor },
      expectedStatus: body.expectedStatus,
      params: body.params,
      context: requestContext(request, requestId),
    });

    return transitionResponse(outcome, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

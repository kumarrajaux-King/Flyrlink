/**
 * The HTTP boundary of the lifecycle services.
 *
 * Every transition route does the same three things, so they live here once:
 * authenticate, validate the body, and call the service as a HUMAN actor built
 * from the session. The route never decides anything about the transition —
 * that is the service's, and the response simply reports its outcome.
 *
 * It does hold platform authority to one extra standard (approved at the Phase
 * 8 review). When the caller is acting on an `:any` grant — overriding the
 * parties' own flow rather than taking part in it — a HIGH or CRITICAL
 * transition must carry a reason, and must be confirmed against the status the
 * caller reviewed. That is the same justification the admin control plane
 * requires, so an administrator cannot sidestep it by using this endpoint
 * instead of `/api/admin/**`. A party acting on their own engagement holds only
 * the `:own` grant and is unaffected.
 */

import { checkJustification } from '../authz/admin-policy';
import { type Actor, can } from '../authz/authorize';
import { type Permission, scopeOf } from '../authz/roles';
import type { TransitionRisk } from '../../domain/lifecycle/machine';
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
  readonly confirm?: boolean | undefined;
  readonly params?: TransitionParams | undefined;
}

/**
 * The part of a state machine this boundary reads: what an event costs and who
 * may fire it. Every Phase 6 machine satisfies it structurally, so no machine
 * had to change.
 */
export interface TransitionRiskTable {
  readonly transitions: readonly {
    readonly event: string;
    readonly risk: TransitionRisk;
    readonly permissions?: readonly Permission[] | undefined;
  }[];
}

interface JustificationRefusal {
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

/**
 * Refuse an unjustified high-risk override. Returns null when the caller is not
 * acting on platform authority, when the event is not high-risk, or when the
 * justification is present.
 */
function justificationRefusal(
  machine: TransitionRiskTable,
  body: TransitionBody,
  actor: Actor,
): JustificationRefusal | null {
  // An unknown event is the service's to refuse, with its own code.
  const definition = machine.transitions.find((transition) => transition.event === body.event);
  if (!definition || (definition.risk !== 'HIGH' && definition.risk !== 'CRITICAL')) return null;

  // `can` applies MFA and account standing too, so a caller who would be
  // refused anyway is told that by the service rather than asked for a reason.
  const onPlatformAuthority = (definition.permissions ?? []).some(
    (permission) => scopeOf(permission) === 'any' && can(actor, permission),
  );
  if (!onPlatformAuthority) return null;

  const failure = checkJustification(definition.risk, {
    reason: body.params?.reason,
    confirm: body.confirm,
    expectedStatus: body.expectedStatus,
  });
  if (!failure) return null;

  return {
    code: failure.code,
    message: failure.message,
    // 428 Precondition Required: the request is well-formed but must be confirmed.
    status: failure.code === 'CONFIRMATION_REQUIRED' ? 428 : 422,
  };
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
  machine: TransitionRiskTable,
): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);
    const body = await parseJsonBody(request, schema);

    const refusal = justificationRefusal(machine, body, session.actor);
    if (refusal) return fail(refusal.code, refusal.message, refusal.status, requestId);

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

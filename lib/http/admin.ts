/**
 * The HTTP boundary of the admin control plane.
 *
 * Routes do three things: resolve the session, validate the request strictly,
 * and call a service as the session's human. Every authorization decision —
 * RBAC, MFA, the super-admin gate, resource rules, justification — is made
 * inside the service, so no route is the only thing standing between a caller
 * and an administrative action, and a future caller of the same service cannot
 * skip the checks.
 */

import type { AdminOutcome, AdminOutcomeDenyReason, AdminRejectionCode } from '../../services/admin/outcome';
import type { RequestContext } from '../audit/audit';
import type { Actor } from '../authz/authorize';
import { parseJsonBody, requestContext, requireSession } from './auth-context';
import { errorResponse, fail, ok, resolveRequestId } from './response';

/**
 * A read: resolve the session, validate the query, call the service as the
 * session's human. A service returning null is a 404.
 */
export async function handleAdminRead<Q, R>(
  request: Request,
  querySchema: { parse: (input: unknown) => Q },
  read: (actor: Actor, query: Q) => Promise<R | null>,
  notFoundLabel = 'record',
): Promise<Response> {
  const requestId = resolveRequestId(request);
  try {
    const session = await requireSession(request);
    const query = parseQuery(request, querySchema);
    const result = await read(session.actor, query);
    return result === null ? notFound(notFoundLabel, requestId) : ok(result, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/**
 * A mutation: resolve the session, validate the body, call the service with
 * the session's human and the request's audit context, and report its outcome.
 */
export async function handleAdminMutation<B>(
  request: Request,
  bodySchema: { parse: (input: unknown) => B },
  mutate: (actor: Actor, body: B, context: RequestContext) => Promise<AdminOutcome>,
  options: { readonly created?: boolean } = {},
): Promise<Response> {
  const requestId = resolveRequestId(request);
  try {
    const session = await requireSession(request);
    const body = await parseJsonBody(request, bodySchema);
    const outcome = await mutate(session.actor, body, requestContext(request, requestId));
    return adminOutcomeResponse(outcome, requestId, {
      created: Boolean(options.created) && outcome.result === 'APPLIED',
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/** Validate a query string. Unknown parameters are refused like unknown body fields. */
export function parseQuery<T>(request: Request, schema: { parse: (input: unknown) => T }): T {
  const url = new URL(request.url);
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}

const REJECTION_HTTP: Record<AdminRejectionCode, { readonly status: number; readonly code: string }> = {
  NOT_FOUND: { status: 404, code: 'NOT_FOUND' },
  UNKNOWN_EVENT: { status: 400, code: 'ADMIN_UNKNOWN_EVENT' },
  INVALID_TRANSITION: { status: 409, code: 'TRANSITION_INVALID' },
  CONFLICT: { status: 409, code: 'TRANSITION_CONFLICT' },
  AI_NOT_PERMITTED: { status: 403, code: 'TRANSITION_AI_NOT_PERMITTED' },
  ACTOR_NOT_PERMITTED: { status: 403, code: 'TRANSITION_ACTOR_NOT_PERMITTED' },
  FORBIDDEN: { status: 403, code: 'FORBIDDEN_RESOURCE' },
  PRECONDITION_FAILED: { status: 422, code: 'TRANSITION_PRECONDITION_FAILED' },
  WEBHOOK_REJECTED: { status: 422, code: 'TRANSITION_WEBHOOK_REJECTED' },
  REASON_REQUIRED: { status: 422, code: 'REASON_REQUIRED' },
  // 428 Precondition Required: the request is well-formed but must be confirmed.
  CONFIRMATION_REQUIRED: { status: 428, code: 'CONFIRMATION_REQUIRED' },
  NOT_AN_INTERVENTION: { status: 403, code: 'ADMIN_NOT_AN_INTERVENTION' },
};

/** Codes for a FORBIDDEN outcome — the STEP 4 codes, plus the admin resource rules. */
function forbiddenResponse(reason: AdminOutcomeDenyReason | null): { status: number; code: string } {
  switch (reason) {
    case 'NOT_AUTHENTICATED':
      return { status: 401, code: 'UNAUTHENTICATED' };
    case 'MFA_REQUIRED':
      return { status: 403, code: 'MFA_REQUIRED' };
    case 'ACCOUNT_INACTIVE':
      return { status: 403, code: 'ACCOUNT_INACTIVE' };
    case 'SUPER_ADMIN_REQUIRED':
    case 'PRIVILEGED_TARGET':
      return { status: 403, code: 'FORBIDDEN_SUPER_ADMIN_REQUIRED' };
    case 'SELF_ACTION':
      return { status: 403, code: 'FORBIDDEN_SELF_ACTION' };
    case 'CONFLICT_OF_INTEREST':
      return { status: 403, code: 'FORBIDDEN_CONFLICT_OF_INTEREST' };
    default:
      return { status: 403, code: 'FORBIDDEN_RESOURCE' };
  }
}

export function adminOutcomeResponse(
  outcome: AdminOutcome,
  requestId: string,
  options: { readonly created?: boolean; readonly data?: Record<string, unknown> } = {},
): Response {
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
          ...(outcome.cascades.length > 0 ? { cascades: outcome.cascades } : {}),
          ...(outcome.detail ? { detail: outcome.detail } : {}),
          ...options.data,
        },
        requestId,
        options.created ? 201 : 200,
      );
    case 'NO_OP':
      // An idempotent repeat is a success: the requested state already holds.
      return ok(
        {
          result: outcome.result,
          entityType: outcome.entityType,
          entityId: outcome.entityId,
          event: outcome.event,
          status: outcome.status,
          ...options.data,
        },
        requestId,
      );
    default: {
      const mapping =
        outcome.code === 'FORBIDDEN' ? forbiddenResponse(outcome.denyReason) : REJECTION_HTTP[outcome.code];
      return fail(mapping.code, outcome.message, mapping.status, requestId);
    }
  }
}

/** 404 for a read of a record that does not exist (or an id that is not a UUID). */
export function notFound(what: string, requestId: string): Response {
  return fail('NOT_FOUND', `No ${what} with that id.`, 404, requestId);
}

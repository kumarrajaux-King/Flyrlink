/**
 * API response envelope and error mapping.
 *
 * STEP 02 §8 fixes the error shape as `{ error: { code, message, details?, requestId } }`
 * with stable codes, and forbids leaking stack traces or SQL. Both are enforced
 * here so no individual route handler has to remember either rule.
 */

import { randomUUID } from 'node:crypto';

import { ZodError } from 'zod';

import { AuthorizationError } from '../authz/authorize';
import { PasswordPolicyError } from '../auth/password';
import { toFieldErrors } from '../validation/auth';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Reuse an inbound request id when present so logs correlate across services. */
export function resolveRequestId(request?: Request): string {
  const inbound = request?.headers.get(REQUEST_ID_HEADER);
  if (inbound && /^[A-Za-z0-9._-]{1,128}$/.test(inbound)) return inbound;
  return randomUUID();
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, string[]>;
    readonly requestId: string;
  };
}

function json(body: unknown, status: number, requestId: string, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json');
  headers.set(REQUEST_ID_HEADER, requestId);
  // Auth responses must never be cached by a proxy or the browser.
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

export function ok<T>(data: T, requestId: string, status = 200, headers?: HeadersInit): Response {
  return json({ data }, status, requestId, headers);
}

export function fail(
  code: string,
  message: string,
  status: number,
  requestId: string,
  details?: Record<string, string[]>,
): Response {
  const body: ApiErrorBody = {
    error: { code, message, requestId, ...(details ? { details } : {}) },
  };
  return json(body, status, requestId);
}

/**
 * Map a thrown error to a response.
 *
 * Anything unrecognised becomes a generic 500 carrying only the request id — the
 * detail goes to the server log, never to the client, so an internal failure
 * cannot leak schema or query information.
 */
export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof ZodError) {
    return fail(
      'VALIDATION_FAILED',
      'The submitted data is invalid.',
      422,
      requestId,
      toFieldErrors(error),
    );
  }

  if (error instanceof SyntaxError) {
    return fail('MALFORMED_JSON', 'Request body must be valid JSON.', 400, requestId);
  }

  if (error instanceof AuthorizationError) {
    return fail(error.errorCode, 'You are not permitted to perform this action.', error.httpStatus, requestId);
  }

  if (error instanceof PasswordPolicyError) {
    return fail('VALIDATION_FAILED', error.message, 422, requestId, {
      password: [error.message],
    });
  }

  console.error(`[${requestId}] Unhandled error:`, error);
  return fail('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500, requestId);
}

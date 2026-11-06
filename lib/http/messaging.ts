/**
 * The HTTP boundary of the messaging and notification services.
 *
 * Every route does the same three things — resolve the session, call a service,
 * turn the result or the refusal into a response — so they live here once and
 * each route file stays a description of one endpoint.
 *
 * The status mapping is the interesting part. STEP 02 §8 fixes stable error
 * codes that the UI branches on, so a refusal has to arrive as a code, not as
 * prose: an archived thread and a missing permission are both "you cannot post
 * here", and the client needs to tell them apart to show the right thing.
 */

import {
  type MessagingRejectionCode,
  MessagingRejection,
} from '../../services/messaging/conversation-service';
import { requireSession } from './auth-context';
import { errorResponse, fail, resolveRequestId } from './response';
import type { ResolvedSession } from '../../services/auth/session-service';

const REJECTION_HTTP: Record<MessagingRejectionCode, { readonly status: number; readonly code: string }> = {
  NOT_FOUND: { status: 404, code: 'NOT_FOUND' },
  FORBIDDEN: { status: 403, code: 'FORBIDDEN_RESOURCE' },
  CONVERSATION_ARCHIVED: { status: 409, code: 'CONVERSATION_ARCHIVED' },
  NOT_A_MEMBER: { status: 403, code: 'CONVERSATION_NOT_A_MEMBER' },
  NO_SHARED_ENGAGEMENT: { status: 403, code: 'NO_SHARED_ENGAGEMENT' },
  // 429 with no Retry-After: the window is short and fixed, and advertising it
  // precisely would only help something that is already misbehaving.
  RATE_LIMITED: { status: 429, code: 'RATE_LIMITED' },
  MESSAGE_IMMUTABLE: { status: 409, code: 'MESSAGE_IMMUTABLE' },
  ATTACHMENT_REJECTED: { status: 422, code: 'ATTACHMENT_REJECTED' },
  UPLOAD_INCOMPLETE: { status: 409, code: 'UPLOAD_INCOMPLETE' },
};

export function messagingError(error: unknown, requestId: string): Response {
  if (error instanceof MessagingRejection) {
    const mapping = REJECTION_HTTP[error.code];
    return fail(mapping.code, error.message, mapping.status, requestId);
  }
  return errorResponse(error, requestId);
}

/**
 * Run a handler with a resolved session, mapping every refusal to a response.
 *
 * Routes never construct an `Actor` themselves — it comes from the session, as
 * it does everywhere else, so there is no endpoint where a client's claim about
 * who it is reaches a service.
 */
export async function handleMessagingRequest(
  request: Request,
  handler: (session: ResolvedSession, requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId = resolveRequestId(request);
  try {
    const session = await requireSession(request);
    return await handler(session, requestId);
  } catch (error) {
    return messagingError(error, requestId);
  }
}

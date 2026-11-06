/**
 * Request-time authentication context.
 *
 * This is the bridge between an HTTP request and the pure `authorize` decision
 * function: it resolves the session cookie into an `Actor` built entirely from
 * the database.
 *
 * WHY THIS IS NOT NEXT MIDDLEWARE
 *   Next.js middleware cannot resolve a session properly — it runs before the
 *   route on a runtime where the Prisma client and Argon2's native binding are
 *   not available, and it sees only the cookie. Treating a cookie's mere presence
 *   as authentication would be exactly the "never trust the client" violation the
 *   architecture forbids. So authorization happens *inside* route handlers and
 *   services, where the database is reachable, and `proxy.ts` is limited to
 *   cheap redirects.
 */

import { type Actor, AuthorizationError, type ResourceParticipants, assertAuthorized } from '../authz/authorize';
import type { Permission } from '../authz/roles';
import { type Db, prisma } from '../db/client';
import { type ResolvedSession, resolveSession } from '../../services/auth/session-service';
import type { RequestContext } from '../audit/audit';
import { readSessionCookie } from './session-cookie';

/** Resolve the caller's session, or null when unauthenticated. */
export async function getSession(
  request: Request,
  db: Db = prisma,
): Promise<ResolvedSession | null> {
  const rawToken = readSessionCookie(request);
  if (!rawToken) return null;
  return resolveSession(db, rawToken);
}

/** Resolve the caller's actor, or null when unauthenticated. */
export async function getActor(request: Request, db: Db = prisma): Promise<Actor | null> {
  return (await getSession(request, db))?.actor ?? null;
}

/**
 * Require an authenticated session. Throws `AuthorizationError` (→ 401) when
 * absent, so handlers do not each re-implement the null check.
 */
export async function requireSession(
  request: Request,
  db: Db = prisma,
): Promise<ResolvedSession> {
  const session = await getSession(request, db);
  if (!session) {
    // The permission is nominal: the failure is authentication, not a specific grant.
    throw new AuthorizationError('NOT_AUTHENTICATED', 'user:read:any');
  }
  return session;
}

/**
 * Require a session that also satisfies a permission (and, for `:own` scopes, a
 * resource). This is the single entry point route handlers should use.
 */
export async function requirePermission(
  request: Request,
  permission: Permission,
  resource?: ResourceParticipants,
  db: Db = prisma,
): Promise<ResolvedSession> {
  const session = await requireSession(request, db);
  assertAuthorized(session.actor, permission, resource);
  return session;
}

/** Extract audit metadata from the request. */
export function requestContext(request: Request, requestId: string): RequestContext {
  return {
    // Trust order matters: the platform's own forwarding header first, then the
    // conventional proxy header. Neither is authenticated, so this is recorded
    // as evidence for operators, never used for an authorization decision.
    ipAddress:
      request.headers.get('x-real-ip') ??
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      null,
    userAgent: request.headers.get('user-agent'),
    requestId,
  };
}

/** Parse and validate a JSON body. Throws on malformed JSON or schema failure. */
export async function parseJsonBody<T>(
  request: Request,
  schema: { parse: (input: unknown) => T },
): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new SyntaxError('Request body must be valid JSON.');
  }
  return schema.parse(payload);
}

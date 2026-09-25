/**
 * Next.js middleware — navigation redirects ONLY.
 *
 * WHY THERE IS NO RBAC HERE
 *   Middleware runs before the route, on a runtime where the Prisma client and
 *   Argon2's native binding are unavailable, and all it can see is the cookie.
 *   The only check it could perform is "a session cookie is present", which says
 *   nothing about whether that session is valid, revoked, expired, MFA-cleared,
 *   or attached to an active account with the right role. Treating cookie presence
 *   as authorization would be precisely the "never trust the client" violation the
 *   architecture forbids (STEP 02 §1).
 *
 *   So authorization lives in two places that can actually verify it:
 *     - route handlers, via `requirePermission` (lib/http/auth-context.ts)
 *     - services, via `assertAuthorized` (lib/authz/authorize.ts)
 *
 *   This file exists purely so an unauthenticated visitor gets a clean redirect to
 *   the sign-in page instead of a flash of an empty dashboard. It is a UX nicety
 *   and must never be relied on as a security boundary.
 *
 *   Note it deliberately does NOT guard `/api/*`: an API route must answer with a
 *   proper 401/403 JSON envelope, not an HTML redirect.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE_NAME } from './lib/http/session-cookie';

/** Page prefixes that are pointless to render without a session. */
const AUTHENTICATED_PREFIXES = [
  '/dashboard',
  '/projects',
  '/expert',
  '/admin',
  '/settings',
  // Phase 9 surfaces.
  '/messages',
  '/notifications',
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const needsSession = AUTHENTICATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!needsSession) return NextResponse.next();

  // Presence only. Validity is decided server-side by the route or service.
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (hasCookie) return NextResponse.next();

  const signIn = new URL('/login', request.url);
  signIn.searchParams.set('next', pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  /**
   * Page routes only. `/api` is excluded on purpose (see above), along with static
   * assets and Next internals.
   */
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};

/**
 * Next.js middleware — two cheap, early checks. Neither is the security
 * boundary.
 *
 * WHY THERE IS NO RBAC HERE
 *   Middleware runs before the route, on a runtime where the Prisma client and
 *   Argon2's native binding are unavailable, and all it can see is the cookie.
 *   The only check it could perform is "a session cookie is present", which says
 *   nothing about whether that session is valid, revoked, expired, MFA-cleared,
 *   or attached to an active account with the right role. Treating cookie
 *   presence as authorization would be precisely the "never trust the client"
 *   violation the architecture forbids (STEP 02 §1).
 *
 *   So authorization lives in three places that can actually verify it:
 *     - route handlers, via `requirePermission` (lib/http/auth-context.ts)
 *     - server components, via `requireUser` / `requirePermissionOnPage`
 *       (lib/http/server-session.ts)
 *     - services, via `assertAuthorized` (lib/authz/authorize.ts)
 *
 *   The redirect below exists so an unauthenticated visitor gets a clean sign-in
 *   page instead of a flash of an empty dashboard. It must never be relied on as
 *   a security boundary, and nothing does.
 *
 * WHAT IT DOES DO FOR `/api`
 *   One origin check on state-changing requests, as defence in depth behind the
 *   `SameSite=Lax` cookie. API routes answer with a JSON envelope, never an HTML
 *   redirect, so they are handled separately below.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { checkOrigin } from './lib/http/origin';
import { SESSION_COOKIE_NAME } from './lib/http/session-cookie';

/** Page prefixes that are pointless to render without a session. */
const AUTHENTICATED_PREFIXES = [
  '/dashboard',
  '/projects',
  '/expert',
  '/admin',
  '/settings',
  '/messages',
  '/notifications',
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (checkOrigin(request) === 'CROSS_ORIGIN') {
      return NextResponse.json(
        {
          error: {
            code: 'CROSS_ORIGIN_REQUEST',
            message: 'This request did not come from this site.',
            requestId: request.headers.get('x-request-id') ?? 'middleware',
          },
        },
        { status: 403 },
      );
    }
    return NextResponse.next();
  }

  const needsSession = AUTHENTICATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!needsSession) return NextResponse.next();

  // Presence only. Validity is decided server-side by the page or the service.
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (hasCookie) return NextResponse.next();

  const signIn = new URL('/login', request.url);
  signIn.searchParams.set('next', pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  /**
   * Page routes and `/api`, which are handled differently above. Static assets
   * and Next internals are excluded.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

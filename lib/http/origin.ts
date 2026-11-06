/**
 * Same-origin enforcement for state-changing API requests.
 *
 * WHAT ALREADY DEFENDS AGAINST CSRF
 *   The session cookie is `SameSite=Lax`, so a browser does not attach it to a
 *   cross-site POST at all. That is the primary control and it is not weakened
 *   by anything here.
 *
 * WHY ADD THIS ANYWAY
 *   Lax is a browser behaviour, and the set of browsers is not fixed. A second,
 *   independent check that costs one header comparison is worth having: if a
 *   request declares an origin, that origin must be ours.
 *
 * WHY A MISSING ORIGIN IS ALLOWED
 *   Browsers send `Origin` on every cross-origin request and on same-origin
 *   POST, so a forged cross-site request cannot suppress it — the header is
 *   set by the browser, not the page. Non-browser callers (curl, a server, the
 *   test suite) legitimately send none, and rejecting those would break every
 *   integration without closing anything.
 */

export type OriginVerdict = 'ALLOWED' | 'CROSS_ORIGIN';

/** Methods that can change something, and therefore need checking. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutating(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

/**
 * Decide whether a request may proceed.
 *
 * `expected` is the host the request was addressed to, taken from the request
 * URL rather than from configuration — so this keeps working on localhost, on a
 * preview URL and in production without an environment variable to forget.
 */
export function checkOrigin(request: { method: string; headers: Headers; url: string }): OriginVerdict {
  if (!isMutating(request.method)) return 'ALLOWED';

  const origin = request.headers.get('origin');
  if (!origin) return 'ALLOWED';

  let declared: URL;
  try {
    declared = new URL(origin);
  } catch {
    return 'CROSS_ORIGIN';
  }

  // Compare host, which includes the port. A different port is a different
  // origin, and treating it as ours would defeat the check on a dev machine
  // running two apps.
  const target = new URL(request.url);
  return declared.host === target.host ? 'ALLOWED' : 'CROSS_ORIGIN';
}

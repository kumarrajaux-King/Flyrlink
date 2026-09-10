/**
 * Session cookie handling.
 *
 * STEP 02 §13: httpOnly, Secure, SameSite. The raw session token lives ONLY
 * here — `httpOnly` keeps it out of reach of any script on the page, which is
 * what makes an XSS bug non-fatal for session theft.
 *
 * `SameSite=Lax` rather than `Strict`: Strict would drop the cookie on the
 * top-level navigation back from an email verification or password-reset link,
 * silently logging the user out mid-flow. Lax still blocks the cross-site POSTs
 * that CSRF depends on.
 */

export const SESSION_COOKIE_NAME = 'marketplace_session';

export interface CookieAttributes {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly maxAge?: number;
  readonly expires?: Date;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Serialize a Set-Cookie header value.
 *
 * `Secure` is omitted outside production only so that http://localhost works;
 * in production it is always set.
 */
export function serializeSessionCookie(rawToken: string, expiresAt: Date): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${rawToken}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    `Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}`,
  ];
  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

/** Set-Cookie value that clears the session cookie. */
export function serializeClearedSessionCookie(): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

/** Read the raw session token from a request's Cookie header. */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=');
    if (separator === -1) continue;
    const name = segment.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = segment.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

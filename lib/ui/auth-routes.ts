/**
 * Shared constants and rules for the authentication screens.
 *
 * Small, and worth having in one place: `safeNext` is a security rule, and a
 * second copy of it is a second chance to get it wrong.
 */

/** Where a privileged account without a second factor goes to set one up. */
export const MFA_ENROLLMENT_PATH = '/dashboard/security/mfa';

/** The challenge screen. */
export const MFA_CHALLENGE_PATH = '/login/mfa';

/**
 * A `?next=` value that is safe to follow.
 *
 * Only a same-origin path, so this can never be turned into an open redirect.
 * `//evil.test` is rejected as well as `https://evil.test`: a protocol-relative
 * URL starts with a slash and would otherwise pass a naive check. A backslash
 * is rejected too, because some browsers normalise `/\evil.test` to a host.
 *
 * The default is `/dashboard`, which resolves the role server-side and forwards
 * from there — so no authentication screen ever has to know what a role means.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/')) return '/dashboard';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/dashboard';
  // Never bounce back into the authentication flow itself: that is how a
  // redirect loop is built.
  if (raw === MFA_CHALLENGE_PATH || raw.startsWith(`${MFA_CHALLENGE_PATH}?`)) return '/dashboard';
  if (raw === '/login' || raw.startsWith('/login?')) return '/dashboard';
  return raw;
}

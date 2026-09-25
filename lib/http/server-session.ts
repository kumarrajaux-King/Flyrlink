/**
 * Session resolution for server components.
 *
 * `lib/http/auth-context.ts` resolves a session from a `Request`, which is what
 * a route handler has. A server component has no `Request` — it reads the
 * cookie store — so this is the same resolution reached the other way. Both end
 * at `resolveSession`, so there is one place that decides what a token means.
 *
 * WHY PAGES RESOLVE THE SESSION THEMSELVES
 *   `middleware.ts` redirects a visitor with no session cookie, but that is a
 *   convenience and never the control: it sees only that a cookie exists, not
 *   whether it is valid, revoked, expired, or attached to an active account.
 *   Every protected page re-resolves here, server-side, before rendering
 *   anything — so a forged or stale cookie renders nothing, rather than a shell
 *   that leaks the shape of someone's account.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { dashboardForPath, permissionsForDashboardPath } from '../authz/dashboards';
import { type Permission, type RoleName, permissionsForRoles } from '../authz/roles';
import { prisma } from '../db/client';
import { type ResolvedSession, resolveSession } from '../../services/auth/session-service';
import { SESSION_COOKIE_NAME } from './session-cookie';

/** What a protected page knows about the person viewing it. */
export interface CurrentUser {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly roles: readonly RoleName[];
  readonly accountActive: boolean;
  readonly mfaEnabled: boolean;
  readonly mfaChallengePending: boolean;
  readonly expiresAt: string;
}

/** The caller's session, or null when there is no valid one. */
export async function getServerSession(): Promise<ResolvedSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return resolveSession(prisma, token);
}

/**
 * The caller's identity for rendering, or null.
 *
 * One extra read for the name and email, which the session itself does not
 * carry — the `Actor` deliberately holds only what an authorization decision
 * needs.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession();
  if (!session) return null;

  const user = await prisma.user.findFirst({
    where: { id: session.actor.userId, deletedAt: null },
    select: { fullName: true, email: true, mfaEnabled: true },
  });
  if (!user) return null;

  return {
    userId: session.actor.userId,
    fullName: user.fullName,
    email: user.email,
    roles: session.actor.roles,
    accountActive: session.actor.accountActive,
    mfaEnabled: user.mfaEnabled,
    mfaChallengePending: session.mfaChallengePending,
    expiresAt: session.expiresAt.toISOString(),
  };
}

/**
 * Require a signed-in viewer, or send them to sign in and come back.
 *
 * `next` is carried so the person lands where they were going. `/login` only
 * follows a same-origin path, so this cannot be turned into an open redirect.
 */
export async function requireUser(returnTo: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return user;
}

/**
 * Require a viewer who holds at least one of `permissions`.
 *
 * This is the server-side gate for a whole screen. It is not a substitute for
 * the checks inside services and route handlers — a page rendering is not an
 * authorization decision about the data it later asks for — but it stops a
 * role from reaching a surface that was never meant for it.
 */
export async function requirePermissionOnPage(
  returnTo: string,
  permissions: readonly Permission[],
): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  const held = permissionsForRoles(user.roles);
  if (!permissions.some((permission) => held.has(permission))) {
    redirect('/dashboard?denied=1');
  }
  return user;
}

/**
 * Gate a dashboard by its own path.
 *
 * The permissions come from the union of the roles that land there, so a role
 * is never refused the surface `/dashboard` forwards it to. Returns the viewer
 * alongside the dashboard entry that matches one of their roles, so the screen
 * describes itself in their terms.
 */
export async function requireDashboard(
  path: string,
): Promise<{ user: CurrentUser; dashboard: NonNullable<ReturnType<typeof dashboardForPath>> }> {
  const user = await requirePermissionOnPage(path, permissionsForDashboardPath(path));
  return { user, dashboard: dashboardForPath(path, user.roles)! };
}

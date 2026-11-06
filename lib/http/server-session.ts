/**
 * Session resolution for server components.
 *
 * `lib/http/auth-context.ts` resolves a session from a `Request`, which is what
 * a route handler has. A server component has no `Request` — it reads the
 * cookie store — so this is the same resolution reached the other way. Both end
 * at `resolveSession`, so there is one place that decides what a token means.
 *
 * WHY PAGES RESOLVE THE SESSION THEMSELVES
 *   `proxy.ts` redirects a visitor with no session cookie, but that is a
 *   convenience and never the control: it sees only that a cookie exists, not
 *   whether it is valid, revoked, expired, or attached to an active account.
 *   Every protected page re-resolves here, server-side, before rendering
 *   anything — so a forged or stale cookie renders nothing, rather than a shell
 *   that leaks the shape of someone's account.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { type Actor, can } from '../authz/authorize';
import {
  DASHBOARDS,
  type Dashboard,
  dashboardForPath,
  permissionsForDashboardPath,
  primaryDashboard,
} from '../authz/dashboards';
import { type Permission, type RoleName, requiresMfa } from '../authz/roles';
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
  /** True once this session has cleared MFA to the standard the roles demand. */
  readonly mfaSatisfied: boolean;
  readonly mfaChallengePending: boolean;
  readonly mfaEnrollmentRequired: boolean;
  readonly expiresAt: string;
}

/** The authorization identity behind a `CurrentUser`. */
export function actorFor(user: CurrentUser): Actor {
  return {
    userId: user.userId,
    roles: user.roles,
    mfaSatisfied: user.mfaSatisfied,
    accountActive: user.accountActive,
  };
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
    mfaSatisfied: session.actor.mfaSatisfied,
    mfaChallengePending: session.mfaChallengePending,
    mfaEnrollmentRequired: session.mfaEnrollmentRequired,
    expiresAt: session.expiresAt.toISOString(),
  };
}

/**
 * Where `/dashboard` should send this viewer — or that it should keep them.
 *
 * WHY THIS IS NOT JUST `primaryDashboard`
 *   `primaryDashboard` answers from the roles alone: an ADMIN belongs in the
 *   control plane. That is true and not sufficient, because the destination
 *   applies `authorize`, and `authorize` can refuse the very role that was
 *   routed there — an administrator who has not cleared MFA holds ADMIN and is
 *   still turned away.
 *
 *   Forwarding them anyway means `/dashboard` sends someone to a page it
 *   already knows will bounce them back. Today that terminates, because the
 *   bounce carries `?mfa=1` and this page stops forwarding when it sees one.
 *   Relying on that is how the ERR_TOO_MANY_REDIRECTS bug happened the first
 *   time: a redirect loop is not an error message, it is a browser giving up.
 *
 *   So the decision asks the same question the destination will, and keeps
 *   anyone the answer would refuse — with `blockedByMfa` saying why, so the
 *   screen can explain rather than silently doing nothing.
 */
export function landingDecision(user: CurrentUser): {
  readonly destination: Dashboard | null;
  readonly blockedByMfa: boolean;
} {
  const actor = actorFor(user);
  const admits = (dashboard: Dashboard): boolean =>
    dashboard.permissions.some((permission) => can(actor, permission, { ownerUserId: user.userId }));

  const primary = primaryDashboard(user.roles);
  if (primary && admits(primary)) return { destination: primary, blockedByMfa: false };

  // Their own surface refused them. Say so when it was the MFA gate, and try
  // the shared surface — which is itself gated, and often refuses too: the MFA
  // gate applies to the actor rather than to the permission, so an un-cleared
  // administrator holds nothing usable, not even their own customer grants.
  // Coming back with no destination is the right answer there; `/dashboard`
  // renders regardless and explains, which is what it is for.
  const blockedByMfa = Boolean(primary) && requiresMfa(user.roles) && !user.mfaSatisfied;
  const fallback = DASHBOARDS.find((dashboard) => dashboard.path === '/dashboard' && admits(dashboard)) ?? null;
  return { destination: fallback, blockedByMfa };
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
 *
 * It asks `authorize`, not the permission table, so the screen is gated by the
 * same decision function every service uses: account standing and the MFA gate
 * apply here too. Checking the table alone let an administrator with an
 * un-cleared session render the whole control plane and only meet a refusal
 * when a panel went to fetch something.
 *
 * The viewer is passed as the resource, which is what makes an `:own`-scoped
 * gate — "your own workspace" — answerable at all.
 */
export async function requirePermissionOnPage(
  returnTo: string,
  permissions: readonly Permission[],
): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  const actor = actorFor(user);
  const allowed = permissions.some((permission) =>
    can(actor, permission, { ownerUserId: user.userId }),
  );
  if (allowed) return user;

  // Separate reasons, because the remedies are different: one is "you cannot be
  // here", the other is "finish signing in".
  if (requiresMfa(user.roles) && !user.mfaSatisfied) redirect('/dashboard?mfa=1');
  redirect('/dashboard?denied=1');
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

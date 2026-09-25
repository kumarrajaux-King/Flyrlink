/**
 * Which surface a role lands on.
 *
 * Pure, so the routing decision is unit-testable without a browser or a
 * database — and so "where does a FINANCE user go?" is answerable by reading
 * one table rather than tracing redirects.
 *
 * ROUTE NAMING FOLLOWS THE APPROVED IA
 *   `docs/architecture/information-architecture.md` §2 puts the client app at
 *   `/dashboard`, the talent app at `/expert`, and *every* control-plane role —
 *   ADMIN, SUPER_ADMIN, FINANCE, SUPPORT, VERIFICATION_MANAGER — under
 *   `/admin`. So the finance, support and verification dashboards are sections
 *   of the control plane rather than new top-level routes; inventing
 *   `/finance` and `/support` would contradict a settled decision for no gain.
 *
 * ONE ACCOUNT, SEVERAL ROLES
 *   A-02 allows it, so landing has to be deterministic. The precedence below
 *   sends a person to the most privileged surface they hold, which is the one
 *   they signed in to use; the shell still lists every surface they can reach,
 *   so nothing is hidden by the choice.
 */

import type { Permission, RoleName } from './roles';

export interface Dashboard {
  readonly role: RoleName;
  readonly path: string;
  readonly label: string;
  /** What the screen is for, in one line. Shown on the placeholder surfaces. */
  readonly purpose: string;
  /** Holding any of these is what lets a viewer open the screen. */
  readonly permissions: readonly Permission[];
}

/**
 * Most privileged first. A person holding both EXPERT and ADMIN lands in the
 * control plane, because that is the account they are signing in as.
 */
export const DASHBOARDS: readonly Dashboard[] = [
  {
    role: 'SUPER_ADMIN',
    path: '/admin',
    label: 'Control plane',
    purpose: 'Platform administration, with the actions no other role may take.',
    permissions: ['user:role:assign:any', 'config:update:any'],
  },
  {
    role: 'ADMIN',
    path: '/admin',
    label: 'Control plane',
    purpose: 'Day-to-day operations: people, engagements, disputes and oversight.',
    permissions: ['user:read:any', 'project:read:any'],
  },
  {
    role: 'FINANCE',
    path: '/admin/finance',
    label: 'Finance',
    purpose: 'Payouts, refunds, commission and the ledger.',
    permissions: ['ledger:read:any', 'payout:approve:any'],
  },
  {
    role: 'VERIFICATION_MANAGER',
    path: '/admin/verification',
    label: 'Verification',
    purpose: 'The expert verification queue, and the decisions recorded against it.',
    permissions: ['expert:verify:any'],
  },
  {
    role: 'SUPPORT',
    path: '/admin/support',
    label: 'Support',
    purpose: 'Look up an account or an engagement to answer a ticket.',
    permissions: ['ticket:read:any', 'ticket:respond:any'],
  },
  {
    role: 'EXPERT',
    path: '/expert',
    label: 'Expert workspace',
    purpose: 'Invitations, active work, deliverables and earnings.',
    permissions: ['expert:update:own'],
  },
  {
    role: 'CUSTOMER',
    path: '/dashboard',
    label: 'Client workspace',
    purpose: 'Your projects, approvals due, and what is waiting on you.',
    permissions: ['project:create:own'],
  },
];

/** The dashboard a viewer lands on, or null when they hold no known role. */
export function primaryDashboard(roles: readonly RoleName[]): Dashboard | null {
  return DASHBOARDS.find((dashboard) => roles.includes(dashboard.role)) ?? null;
}

/**
 * Every dashboard a viewer may open, in precedence order and de-duplicated by
 * path — ADMIN and SUPER_ADMIN share one surface, so an account holding both
 * sees it once.
 */
export function reachableDashboards(roles: readonly RoleName[]): readonly Dashboard[] {
  const seen = new Set<string>();
  const out: Dashboard[] = [];
  for (const dashboard of DASHBOARDS) {
    if (!roles.includes(dashboard.role) || seen.has(dashboard.path)) continue;
    seen.add(dashboard.path);
    out.push(dashboard);
  }
  return out;
}

/** Where to send someone after signing in. `/dashboard` is the safe fallback. */
export function landingPath(roles: readonly RoleName[]): string {
  return primaryDashboard(roles)?.path ?? '/dashboard';
}

/** The dashboard registered at a path, for a screen checking its own gate. */
export function dashboardForPath(path: string): Dashboard | null {
  return DASHBOARDS.find((dashboard) => dashboard.path === path) ?? null;
}

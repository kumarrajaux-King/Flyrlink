/**
 * Role → dashboard routing.
 *
 * Pure, so every role's landing surface is pinned without a browser. The
 * multi-role cases matter most: A-02 allows one account to hold several roles,
 * and "where does this person land?" must have exactly one answer.
 */

import { describe, expect, it } from 'vitest';

import {
  DASHBOARDS,
  dashboardForPath,
  landingPath,
  primaryDashboard,
  reachableDashboards,
} from '../../lib/authz/dashboards';
import { ROLE_NAMES, type RoleName, permissionsForRoles } from '../../lib/authz/roles';

describe('dashboard routing', () => {
  it('gives every role a landing surface', () => {
    for (const role of ROLE_NAMES) {
      const dashboard = primaryDashboard([role]);
      expect(dashboard, role).not.toBeNull();
      expect(dashboard!.path, role).toMatch(/^\//);
    }
  });

  it('sends each role to its own surface', () => {
    const expected: Record<RoleName, string> = {
      CUSTOMER: '/dashboard',
      EXPERT: '/expert',
      ADMIN: '/admin',
      SUPER_ADMIN: '/admin',
      FINANCE: '/admin/finance',
      SUPPORT: '/admin/support',
      VERIFICATION_MANAGER: '/admin/verification',
    };
    for (const [role, path] of Object.entries(expected) as [RoleName, string][]) {
      expect(landingPath([role]), role).toBe(path);
    }
  });

  it('keeps every control-plane role under /admin, as the IA settles', () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN', 'FINANCE', 'SUPPORT', 'VERIFICATION_MANAGER'] as RoleName[]) {
      expect(landingPath([role]), role).toMatch(/^\/admin/);
    }
  });

  it('lands a multi-role account on the most privileged surface it holds', () => {
    expect(landingPath(['CUSTOMER', 'EXPERT'])).toBe('/expert');
    expect(landingPath(['EXPERT', 'ADMIN'])).toBe('/admin');
    expect(landingPath(['CUSTOMER', 'FINANCE'])).toBe('/admin/finance');
    // Order of the caller's array must not change the answer.
    expect(landingPath(['ADMIN', 'EXPERT'])).toBe(landingPath(['EXPERT', 'ADMIN']));
  });

  it('falls back to /dashboard for an account with no role', () => {
    expect(landingPath([])).toBe('/dashboard');
    expect(primaryDashboard([])).toBeNull();
  });

  it('lists every surface a viewer can reach, without repeating a shared one', () => {
    expect(reachableDashboards(['CUSTOMER', 'EXPERT']).map((d) => d.path)).toEqual(['/expert', '/dashboard']);
    // ADMIN and SUPER_ADMIN share one surface.
    expect(reachableDashboards(['ADMIN', 'SUPER_ADMIN']).map((d) => d.path)).toEqual(['/admin']);
    expect(reachableDashboards([])).toEqual([]);
  });

  it('only gates a dashboard on permissions its role actually holds', () => {
    // A gate naming a grant the role lacks would lock the role out of its own
    // landing page — the kind of bug that only shows up in production.
    for (const dashboard of DASHBOARDS) {
      const held = permissionsForRoles([dashboard.role]);
      expect(
        dashboard.permissions.some((permission) => held.has(permission)),
        `${dashboard.role} → ${dashboard.path}`,
      ).toBe(true);
    }
  });

  it('resolves a path back to its dashboard', () => {
    expect(dashboardForPath('/admin/finance')?.role).toBe('FINANCE');
    expect(dashboardForPath('/nope')).toBeNull();
  });
});

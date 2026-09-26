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
  permissionsForDashboardPath,
  primaryDashboard,
  reachableDashboards,
} from '../../lib/authz/dashboards';
import { can } from '../../lib/authz/authorize';
import { ROLE_NAMES, type RoleName, permissionsForRoles } from '../../lib/authz/roles';
import { type CurrentUser, actorFor, landingDecision } from '../../lib/http/server-session';

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

  it('resolves a shared path to the entry matching the viewer', () => {
    // ADMIN and SUPER_ADMIN share `/admin`; answering with the first entry gave
    // a plain ADMIN the SUPER_ADMIN gate, and locked them out of their own
    // landing page.
    expect(dashboardForPath('/admin', ['ADMIN'])?.role).toBe('ADMIN');
    expect(dashboardForPath('/admin', ['SUPER_ADMIN'])?.role).toBe('SUPER_ADMIN');
    expect(dashboardForPath('/admin', ['CUSTOMER', 'ADMIN'])?.role).toBe('ADMIN');
  });

  it('gates a shared path on the union of the roles that land there', () => {
    const admin = permissionsForDashboardPath('/admin');
    expect(admin).toContain('user:read:any');
    expect(admin).toContain('user:role:assign:any');
  });

  /**
   * The invariant that matters, because breaking it is not an error message.
   *
   * `/dashboard` forwards by role. If the surface it forwards to then refuses
   * that role, the refusal comes back to `/dashboard`, which forwards again:
   * the browser stops with ERR_TOO_MANY_REDIRECTS rather than saying anything.
   */
  it('never sends a role to a surface that would refuse it', () => {
    for (const role of ROLE_NAMES) {
      const path = landingPath([role]);
      const gate = permissionsForDashboardPath(path);
      const held = permissionsForRoles([role]);
      // `/dashboard` is the fallback and has its own entry; every other path
      // must admit the role routed to it.
      expect(gate.some((permission) => held.has(permission)), `${role} → ${path}`).toBe(true);
    }
  });

  it('holds that invariant for multi-role accounts too', () => {
    for (const roles of [
      ['CUSTOMER', 'ADMIN'],
      ['CUSTOMER', 'SUPER_ADMIN'],
      ['EXPERT', 'FINANCE'],
      ['CUSTOMER', 'EXPERT'],
      ['EXPERT', 'SUPPORT'],
      ['CUSTOMER', 'VERIFICATION_MANAGER'],
    ] as RoleName[][]) {
      const path = landingPath(roles);
      const gate = permissionsForDashboardPath(path);
      const held = permissionsForRoles(roles);
      expect(gate.some((permission) => held.has(permission)), `${roles.join('+')} → ${path}`).toBe(true);
    }
  });
});

/**
 * The forward itself, not just the table.
 *
 * `landingPath` says where a role belongs. `landingDecision` says where this
 * *viewer* may actually go, by asking the same question the destination will —
 * which is not the same answer, because `authorize` can refuse the very role
 * that was routed there. An un-cleared administrator holds ADMIN and is still
 * turned away from `/admin`.
 */
describe('the landing forward', () => {
  function viewer(overrides: Partial<CurrentUser> = {}): CurrentUser {
    return {
      userId: '018f3c2a-7b1e-7c4d-9e2f-1a2b3c4d5e6f',
      fullName: 'Test Viewer',
      email: 'viewer@example.test',
      roles: ['CUSTOMER'],
      accountActive: true,
      mfaEnabled: false,
      mfaSatisfied: true,
      mfaChallengePending: false,
      mfaEnrollmentRequired: false,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      ...overrides,
    };
  }

  it('sends a cleared viewer to the surface their role owns', () => {
    for (const [roles, path] of [
      [['CUSTOMER'], '/dashboard'],
      [['EXPERT'], '/expert'],
      [['SUPPORT'], '/admin/support'],
      [['ADMIN'], '/admin'],
      [['FINANCE'], '/admin/finance'],
      [['VERIFICATION_MANAGER'], '/admin/verification'],
    ] as [RoleName[], string][]) {
      const decision = landingDecision(viewer({ roles, mfaEnabled: true, mfaSatisfied: true }));
      expect(decision.destination?.path, roles.join('+')).toBe(path);
      expect(decision.blockedByMfa).toBe(false);
    }
  });

  it('holds an un-cleared privileged viewer instead of bouncing them', () => {
    // Registration grants CUSTOMER, so this is the realistic shape: an account
    // that is a customer as well as an administrator.
    //
    // There is no destination at all, and that is correct rather than a gap:
    // `authorize` applies the MFA gate to the *actor*, not to the permission,
    // so holding an un-cleared ADMIN withholds every permission the account
    // has — including the customer ones. `/dashboard` renders anyway, because
    // it gates on `requireUser` and its job here is to explain the refusal.
    for (const role of ['ADMIN', 'SUPER_ADMIN', 'FINANCE', 'VERIFICATION_MANAGER'] as RoleName[]) {
      const decision = landingDecision(
        viewer({ roles: ['CUSTOMER', role], mfaEnabled: false, mfaSatisfied: false }),
      );
      expect(decision.blockedByMfa, role).toBe(true);
      expect(decision.destination, role).toBeNull();
    }
  });

  it('holds a suspended viewer too, whatever they hold on paper', () => {
    const decision = landingDecision(viewer({ roles: ['CUSTOMER', 'EXPERT'], accountActive: false }));
    expect(decision.destination).toBeNull();
    // Not an MFA problem — the account itself is not permitted to act.
    expect(decision.blockedByMfa).toBe(false);
  });

  /**
   * The invariant, restated where it actually bites.
   *
   * `/dashboard` forwards. If it forwards to a surface that refuses, the
   * refusal comes back here — and the only thing that stopped an infinite
   * redirect was this page noticing the `?mfa=1` on the way back. Not sending
   * them in the first place is the fix; this is what pins it.
   */
  it('never names a destination that would refuse the viewer', () => {
    for (const roles of [
      ['CUSTOMER'],
      ['EXPERT'],
      ['CUSTOMER', 'EXPERT'],
      ['CUSTOMER', 'ADMIN'],
      ['CUSTOMER', 'SUPER_ADMIN'],
      ['EXPERT', 'FINANCE'],
      ['CUSTOMER', 'SUPPORT'],
      ['CUSTOMER', 'VERIFICATION_MANAGER'],
    ] as RoleName[][]) {
      for (const mfaSatisfied of [true, false]) {
        const user = viewer({ roles, mfaEnabled: mfaSatisfied, mfaSatisfied });
        const { destination } = landingDecision(user);
        if (!destination) continue;
        const gate = permissionsForDashboardPath(destination.path);
        expect(
          gate.some((permission) => can(actorFor(user), permission, { ownerUserId: user.userId })),
          `${roles.join('+')} (mfa=${mfaSatisfied}) → ${destination.path}`,
        ).toBe(true);
      }
    }
  });
});

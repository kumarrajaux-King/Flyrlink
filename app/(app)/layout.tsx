/**
 * Layout for every signed-in surface.
 *
 * This is the authorization boundary for the whole group: the session is
 * resolved here, server-side, before any child renders. `middleware.ts` has
 * usually redirected an anonymous visitor already, but it only ever saw that a
 * cookie existed — a forged, revoked or expired one gets past it and is stopped
 * here.
 *
 * The identity handed to the shell comes from the database, never from the
 * client, so the name and role in the header cannot be altered by anything the
 * browser sends.
 */

import type { ReactNode } from 'react';

import { AppShell } from '../../components/app/app-shell';
import { reachableDashboards } from '../../lib/authz/dashboards';
import { requireUser } from '../../lib/http/server-session';

export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const user = await requireUser('/dashboard');

  return (
    <AppShell
      user={{
        fullName: user.fullName,
        email: user.email,
        roles: [...user.roles],
        mfaEnabled: user.mfaEnabled,
      }}
      dashboards={reachableDashboards(user.roles).map((dashboard) => ({
        path: dashboard.path,
        label: dashboard.label,
      }))}
    >
      {children}
    </AppShell>
  );
}

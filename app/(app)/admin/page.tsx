/**
 * `/admin` — the control plane.
 *
 * A protected placeholder, not a mock: the gate above it is real, and nothing
 * on it is invented. Day-to-day operations across people, engagements and disputes.
 *
 * Every action behind it is governed: a non-trivial change needs a reason, and a HIGH or CRITICAL one needs explicit confirmation of the state being changed.
 */

import { DashboardScaffold } from '../../../components/app/dashboard-scaffold';
import { dashboardForPath } from '../../../lib/authz/dashboards';
import { requirePermissionOnPage } from '../../../lib/http/server-session';

export const dynamic = 'force-dynamic';

const PATH = '/admin';

export default async function Page() {
  const dashboard = dashboardForPath(PATH)!;
  const user = await requirePermissionOnPage(PATH, dashboard.permissions);

  return (
    <DashboardScaffold
      title="Control plane"
      role={user.roles.find((role) => role === 'ADMIN') ?? user.roles[0] ?? 'ADMIN'}
      purpose={dashboard.purpose}
      permissions={['user:read:any', 'project:read:any', 'dispute:resolve:any', 'audit:read:any']}
      pending={[
        'Executive dashboard — GET /api/admin/dashboard is implemented',
        'People, customers and experts — 47 admin routes are implemented',
        'Disputes, reviews and interventions, each requiring a written reason',
        'The append-only audit log',
      ]}
    />
  );
}

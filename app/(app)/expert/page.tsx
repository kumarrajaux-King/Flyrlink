/**
 * `/expert` — the expert workspace.
 *
 * A protected placeholder, not a mock: the gate above it is real, and nothing
 * on it is invented. Invitations, active work, deliverables and earnings.
 */

import { DashboardScaffold } from '../../../components/app/dashboard-scaffold';
import { dashboardForPath } from '../../../lib/authz/dashboards';
import { requirePermissionOnPage } from '../../../lib/http/server-session';

export const dynamic = 'force-dynamic';

const PATH = '/expert';

export default async function Page() {
  const dashboard = dashboardForPath(PATH)!;
  const user = await requirePermissionOnPage(PATH, dashboard.permissions);

  return (
    <DashboardScaffold
      title="Expert workspace"
      role={user.roles.find((role) => role === 'EXPERT') ?? user.roles[0] ?? 'EXPERT'}
      purpose={dashboard.purpose}
      permissions={['expert:update:own', 'assignment:respond:own', 'milestone:submit:own']}
      pending={[
        'Matched invitations, accepted or declined here (Phase 6 backend is live)',
        'Active contracts and the milestones on them',
        'Deliverable submission and the revision loop',
        'Earnings: gross, the 10% commission, and payouts (Phase 10)',
      ]}
    />
  );
}

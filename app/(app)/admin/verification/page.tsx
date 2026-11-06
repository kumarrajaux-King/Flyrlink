/**
 * `/admin/verification` — the verification.
 *
 * A protected placeholder, not a mock: the gate above it is real, and nothing
 * on it is invented. The expert verification queue, and the decisions recorded against it.
 *
 * AI never grants verification. A person reviews the evidence and decides, and the decision is recorded.
 */

import { DashboardScaffold } from '../../../../components/app/dashboard-scaffold';
import { requireDashboard } from '../../../../lib/http/server-session';

export const dynamic = 'force-dynamic';

const PATH = '/admin/verification';

export default async function Page() {
  // Gated by the union of the roles that land here, so a role is never refused
  // the surface `/dashboard` forwarded it to.
  const { user, dashboard } = await requireDashboard(PATH);

  return (
    <DashboardScaffold
      title="Verification"
      role={user.roles.find((role) => role === 'VERIFICATION_MANAGER') ?? user.roles[0] ?? 'VERIFICATION_MANAGER'}
      purpose={dashboard.purpose}
      permissions={['expert:verify:any', 'expert:read:any', 'audit:read:any']}
      pending={[
        'The verification queue, oldest first',
        'Evidence review: identity, credentials, portfolio',
        'Grant or withdraw a badge — recorded against your name',
      ]}
    />
  );
}

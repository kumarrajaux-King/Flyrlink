/**
 * `/admin/support` — the support.
 *
 * A protected placeholder, not a mock: the gate above it is real, and nothing
 * on it is invented. Look up an account or an engagement to answer a ticket.
 *
 * SUPPORT is read-mostly and decides nothing, which is why it sits outside the MFA gate.
 */

import { DashboardScaffold } from '../../../../components/app/dashboard-scaffold';
import { requireDashboard } from '../../../../lib/http/server-session';

export const dynamic = 'force-dynamic';

const PATH = '/admin/support';

export default async function Page() {
  // Gated by the union of the roles that land here, so a role is never refused
  // the surface `/dashboard` forwarded it to.
  const { user, dashboard } = await requireDashboard(PATH);

  return (
    <DashboardScaffold
      title="Support"
      role={user.roles.find((role) => role === 'SUPPORT') ?? user.roles[0] ?? 'SUPPORT'}
      purpose={dashboard.purpose}
      permissions={['ticket:read:any', 'ticket:respond:any', 'user:read:any', 'message:read:any']}
      pending={[
        'Account and engagement lookup — GET /api/admin/support/lookup is implemented',
        'Ticket queue and replies',
        'Read access to a conversation, which is audited every time it is used',
      ]}
    />
  );
}

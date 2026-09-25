/**
 * `/admin/finance` — the finance.
 *
 * A protected placeholder, not a mock: the gate above it is real, and nothing
 * on it is invented. Payouts, refunds, commission and the ledger.
 *
 * Escrow release is refused while any dispute on the project is open; that rule lives in the payment lifecycle, not in this screen.
 */

import { DashboardScaffold } from '../../../../components/app/dashboard-scaffold';
import { dashboardForPath } from '../../../../lib/authz/dashboards';
import { requirePermissionOnPage } from '../../../../lib/http/server-session';

export const dynamic = 'force-dynamic';

const PATH = '/admin/finance';

export default async function Page() {
  const dashboard = dashboardForPath(PATH)!;
  const user = await requirePermissionOnPage(PATH, dashboard.permissions);

  return (
    <DashboardScaffold
      title="Finance"
      role={user.roles.find((role) => role === 'FINANCE') ?? user.roles[0] ?? 'FINANCE'}
      purpose={dashboard.purpose}
      permissions={['ledger:read:any', 'payout:approve:any', 'refund:approve:any', 'commission:configure:any']}
      pending={[
        'Payout queue and approval (release requires this role plus MFA)',
        'Refund approval',
        'The double-entry ledger',
        'Commission rules — SUPER_ADMIN only to change',
      ]}
    />
  );
}

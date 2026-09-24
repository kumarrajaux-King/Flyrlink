/**
 * GET /api/admin/ledger — account balances and per-currency balance check
 * (`ledger:read:any`). Read-only.
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { ledgerSummaryQuerySchema } from '../../../../lib/validation/admin';
import { getLedgerSummary } from '../../../../services/admin/finance-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, ledgerSummaryQuerySchema, (actor, query) => getLedgerSummary({ actor, ...query }));
}

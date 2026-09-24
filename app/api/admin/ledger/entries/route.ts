/**
 * GET /api/admin/ledger/entries — ledger entries (`ledger:read:any`). Read-only.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { ledgerEntryQuerySchema } from '../../../../../lib/validation/admin';
import { listLedgerEntries } from '../../../../../services/admin/finance-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, ledgerEntryQuerySchema, (actor, query) => listLedgerEntries({ actor, ...query }));
}

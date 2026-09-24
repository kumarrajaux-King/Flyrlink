/**
 * GET /api/admin/disputes/:disputeId — the case file: parties, the record it
 * froze, triage history and available triage events.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { emptyQuerySchema } from '../../../../../lib/validation/admin';
import { getDispute } from '../../../../../services/admin/dispute-service';

interface RouteParams {
  readonly params: Promise<{ disputeId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { disputeId } = await params;
  return handleAdminRead(request, emptyQuerySchema, (actor) => getDispute({ actor, disputeId }), 'dispute');
}

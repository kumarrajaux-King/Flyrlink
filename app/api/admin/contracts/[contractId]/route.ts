/**
 * GET /api/admin/contracts/:contractId — one contract with its versions,
 * milestones, open disputes and available interventions.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { emptyQuerySchema } from '../../../../../lib/validation/admin';
import { getContract } from '../../../../../services/admin/oversight-service';

interface RouteParams {
  readonly params: Promise<{ contractId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { contractId } = await params;
  return handleAdminRead(request, emptyQuerySchema, (actor) => getContract({ actor, contractId }), 'contract');
}

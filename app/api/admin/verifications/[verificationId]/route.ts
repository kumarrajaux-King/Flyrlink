/**
 * GET /api/admin/verifications/:verificationId — the case file: evidence, AI
 * findings, previous cases, decision history and the available decisions.
 */

import { handleAdminRead } from '../../../../../lib/http/admin';
import { emptyQuerySchema } from '../../../../../lib/validation/admin';
import { getVerification } from '../../../../../services/admin/verification-service';

interface RouteParams {
  readonly params: Promise<{ verificationId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { verificationId } = await params;
  return handleAdminRead(
    request,
    emptyQuerySchema,
    (actor) => getVerification({ actor, verificationId }),
    'verification case',
  );
}

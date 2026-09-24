/**
 * POST /api/admin/ai/agents/:agentKey/status — the kill switch.
 *
 * Disabling needs `ai:approve:any` (ADMIN, SUPER_ADMIN); enabling needs a super
 * administrator and confirmation.
 */

import { handleAdminMutation } from '../../../../../../../lib/http/admin';
import { agentKeyParamSchema, agentStatusSchema } from '../../../../../../../lib/validation/admin';
import { setAgentStatus } from '../../../../../../../services/admin/ai-operations-service';

interface RouteParams {
  readonly params: Promise<{ agentKey: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { agentKey } = await params;
  return handleAdminMutation(request, agentStatusSchema, (actor, body, context) =>
    setAgentStatus({
      actor,
      agentKey: agentKeyParamSchema.parse(agentKey),
      enabled: body.enabled,
      reason: body.reason,
      confirm: body.confirm,
      context,
    }),
  );
}

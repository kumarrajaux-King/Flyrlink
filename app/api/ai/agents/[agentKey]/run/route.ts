/**
 * POST /api/ai/agents/:agentKey/run
 *
 * Triggers one agent run for the authenticated caller.
 *
 * The caller supplies only the agent key and an input payload. Everything that
 * determines what the agent may *do* — the acting identity, its roles, MFA state
 * and the tool allow-list — is resolved server-side. A client cannot widen an
 * agent's reach by anything it sends.
 *
 * Responds 202: the run itself completed, but any HIGH/CRITICAL action it
 * proposed is held for human approval rather than executed.
 */

import { assertAuthorized } from '../../../../../../lib/authz/authorize';
import { parseJsonBody, requestContext, requireSession } from '../../../../../../lib/http/auth-context';
import { errorResponse, fail, ok, resolveRequestId } from '../../../../../../lib/http/response';
import { agentKeySchema, runAgentSchema } from '../../../../../../lib/validation/ai';
import { runAgent } from '../../../../../../ai/runtime/orchestrator';

interface RouteParams {
  readonly params: Promise<{ agentKey: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const requestId = resolveRequestId(request);

  try {
    const session = await requireSession(request);

    // `ai:run:own` is :own-scoped and the resource is the caller themselves: any
    // active account may run an agent on its own behalf. What the agent can then
    // reach is constrained separately, by the policy engine, against these same
    // roles — so this grant cannot be used to widen data access.
    assertAuthorized(session.actor, 'ai:run:own', { ownerUserId: session.actor.userId });

    const { agentKey: rawKey } = await params;
    const parsedKey = agentKeySchema.safeParse(rawKey);
    if (!parsedKey.success) {
      return fail('UNKNOWN_AGENT', `No agent named "${rawKey}".`, 404, requestId);
    }

    const body = await parseJsonBody(request, runAgentSchema);

    const result = await runAgent({
      agentKey: parsedKey.data,
      input: body.input,
      actor: session.actor,
      projectId: body.projectId,
      entityType: body.entityType,
      entityId: body.entityId,
      trigger: 'USER_REQUEST',
      requestContext: requestContext(request, requestId),
    });

    return ok(
      {
        runId: result.runId,
        status: result.status,
        output: result.output,
        pendingApprovals: result.pendingApprovals,
        // BigInt is not JSON-serialisable.
        costMinor: result.costMinor.toString(),
        currency: result.currency,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      },
      requestId,
      202,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

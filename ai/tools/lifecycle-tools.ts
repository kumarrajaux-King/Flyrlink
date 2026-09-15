/**
 * Lifecycle tools — the AI boundary of the Phase 6 state machines.
 *
 * Exactly one lifecycle event is reachable by an agent: Project MARK_AT_RISK.
 * It is non-financial, MEDIUM risk and reversible by a human (RESOLVE_RISK),
 * and the state machine lists AI_AGENT as an allowed actor for that event and
 * for no other in any of the four machines. A unit test pins that.
 *
 * The tool calls the same transition service as every human and system
 * caller — there is no separate AI write path — so the state machine, the
 * acting human's RBAC, idempotency and audit all apply unchanged. The audit
 * record names both the AI run that acted and the human it acted for.
 */

import { z } from 'zod';

import { transitionProject } from '../../services/lifecycle';
import { registerTool, type ToolContext } from './registry';

const flagProjectAtRiskInput = z.object({
  projectId: z.string(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  evidence: z.string().min(1).max(1000),
});

const flagProjectAtRiskOutput = z.object({
  result: z.enum(['APPLIED', 'NO_OP', 'REJECTED']),
  status: z.string().nullable(),
  rejectionCode: z.string().nullable(),
  message: z.string().nullable(),
});

type FlagProjectAtRiskOutput = z.infer<typeof flagProjectAtRiskOutput>;

export const flagProjectAtRiskTool = registerTool({
  name: 'flagProjectAtRisk',
  description:
    'Mark an ACTIVE project AT_RISK with a risk level and the evidence for it. A human can ' +
    'reverse it. It changes no other state, moves no money and commits no one.',
  riskTier: 'MEDIUM',
  requiredPermission: 'project:update:any',
  // A repeat is a NO_OP in the lifecycle service.
  idempotent: true,
  auditAction: 'ai.tool.flagProjectAtRisk',
  inputSchema: flagProjectAtRiskInput,
  outputSchema: flagProjectAtRiskOutput,
  handler: async (input, context: ToolContext): Promise<FlagProjectAtRiskOutput> => {
    const outcome = await transitionProject(
      {
        entityId: input.projectId,
        event: 'MARK_AT_RISK',
        actor: { kind: 'AI_AGENT', aiRunId: context.aiRunId, onBehalfOf: context.actor },
        params: { riskLevel: input.riskLevel, reason: input.evidence },
        context: context.requestContext,
      },
      context.db,
    );

    switch (outcome.result) {
      case 'APPLIED':
        return { result: 'APPLIED', status: outcome.to, rejectionCode: null, message: null };
      case 'NO_OP':
        return { result: 'NO_OP', status: outcome.status, rejectionCode: null, message: null };
      default:
        // Returned to the model as data, so it can explain rather than retry blindly.
        return { result: 'REJECTED', status: outcome.status, rejectionCode: outcome.code, message: outcome.message };
    }
  },
});

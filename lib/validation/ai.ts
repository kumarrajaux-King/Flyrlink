/**
 * Zod schemas for the AI API boundary.
 *
 * `strictObject` throughout, so a client cannot smuggle an extra field into a run
 * request — notably not `actor`, `riskTier` or `status`, all of which are decided
 * server-side.
 */

import { z } from 'zod';

export const AGENT_KEYS = [
  'PROJECT_ARCHITECT',
  'REQUIREMENTS_ANALYST',
  'ESTIMATION',
  'TALENT_DISCOVERY',
  'MATCHING',
  'TEAM_BUILDER',
  'VERIFICATION',
  'CONTRACT',
  'EXECUTION',
  'RISK',
  'COMMUNICATION',
  'PAYMENT',
  'SUPPORT_RESOLUTION',
] as const;

export const agentKeySchema = z.enum(AGENT_KEYS);

/**
 * The run request.
 *
 * `input` is deliberately an opaque record: each agent validates it against its
 * own schema inside the orchestrator, which keeps one definition of truth per
 * agent rather than duplicating 13 shapes here.
 */
export const runAgentSchema = z.strictObject({
  input: z.record(z.string(), z.unknown()),
  projectId: z.uuid({ version: 'v7' }).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.uuid({ version: 'v7' }).optional(),
});
export type RunAgentRequest = z.infer<typeof runAgentSchema>;

export const approvalDecisionSchema = z
  .strictObject({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().min(1).max(1000).optional(),
  })
  .refine((value) => value.decision === 'APPROVE' || Boolean(value.reason), {
    message: 'A reason is required when rejecting an action.',
    path: ['reason'],
  });
export type ApprovalDecisionRequest = z.infer<typeof approvalDecisionSchema>;

export const listRunsQuerySchema = z.strictObject({
  agentKey: agentKeySchema.optional(),
  status: z
    .enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'VALIDATION_FAILED', 'FAILED', 'TIMED_OUT', 'CANCELLED'])
    .optional(),
  projectId: z.uuid({ version: 'v7' }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

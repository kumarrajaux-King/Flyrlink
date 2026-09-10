/**
 * Human-in-the-loop approval for held AI actions.
 *
 * A HIGH or CRITICAL tool call never executes inline. The orchestrator records it
 * as `PENDING_APPROVAL` and stops. This service is the only path by which such an
 * action can ever execute, and it is reached exclusively through an authenticated
 * human decision.
 *
 * Three independent layers have to agree before a held action runs:
 *
 *   1. `assertAuthorized(actor, 'ai:approve:any')` — RBAC, and MFA for the
 *      privileged roles that hold that permission.
 *   2. CRITICAL actions additionally require SUPER_ADMIN.
 *   3. The database CHECK constraints from STEP 3 refuse to store a HIGH/CRITICAL
 *      action as EXECUTED without an approver, so even a bug here cannot produce
 *      an unapproved execution record.
 *
 * The approving human becomes the acting identity for the execution. They are
 * taking responsibility for the action, so it runs with their permissions rather
 * than inheriting the original requester's.
 */

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import { type Actor, assertAuthorized } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import { redactForStorage } from '../../ai/redaction/redact';
import { executeTool } from '../../ai/tools';

export type ApprovalOutcome =
  | { readonly result: 'EXECUTED'; readonly actionId: string; readonly output: unknown }
  | { readonly result: 'REJECTED'; readonly actionId: string }
  | { readonly result: 'NOT_FOUND' }
  | { readonly result: 'NOT_PENDING'; readonly currentStatus: string }
  | { readonly result: 'SUPER_ADMIN_REQUIRED' }
  | { readonly result: 'EXECUTION_FAILED'; readonly actionId: string; readonly message: string };

export interface PendingActionSummary {
  readonly actionId: string;
  readonly aiRunId: string;
  readonly agentKey: string;
  readonly toolName: string;
  readonly riskTier: string;
  readonly policyReason: string | null;
  readonly requestedPayload: unknown;
  readonly projectId: string | null;
  readonly createdAt: string;
}

/** The admin approval queue (`/admin/ai/approvals`). */
export async function listPendingApprovals(
  params: { actor: Actor; limit?: number },
  db: Db = prisma,
): Promise<readonly PendingActionSummary[]> {
  assertAuthorized(params.actor, 'ai:read:any');

  const actions = await db.aiAction.findMany({
    where: { status: 'PENDING_APPROVAL', requiresHumanApproval: true },
    orderBy: { createdAt: 'asc' },
    take: params.limit ?? 50,
    select: {
      id: true,
      aiRunId: true,
      toolName: true,
      riskTier: true,
      policyReason: true,
      requestedPayload: true,
      createdAt: true,
      aiRun: {
        select: { projectId: true, agent: { select: { key: true } } },
      },
    },
  });

  return actions.map((action) => ({
    actionId: action.id,
    aiRunId: action.aiRunId,
    agentKey: action.aiRun.agent.key,
    toolName: action.toolName,
    riskTier: action.riskTier,
    policyReason: action.policyReason,
    requestedPayload: action.requestedPayload,
    projectId: action.aiRun.projectId,
    createdAt: action.createdAt.toISOString(),
  }));
}

/**
 * Approve and execute a held action.
 *
 * The status transition is a conditional update, so two approvers racing on the
 * same action cannot both execute it.
 */
export async function approveAction(
  params: { actor: Actor; actionId: string; context?: RequestContext },
  db: Db = prisma,
): Promise<ApprovalOutcome> {
  assertAuthorized(params.actor, 'ai:approve:any');

  const action = await db.aiAction.findUnique({
    where: { id: params.actionId },
    select: {
      id: true,
      aiRunId: true,
      toolName: true,
      riskTier: true,
      status: true,
      requestedPayload: true,
    },
  });

  if (!action) return { result: 'NOT_FOUND' };
  if (action.status !== 'PENDING_APPROVAL') {
    return { result: 'NOT_PENDING', currentStatus: action.status };
  }

  // CRITICAL is the tier reserved for financial and account-level effect.
  if (action.riskTier === 'CRITICAL' && !params.actor.roles.includes('SUPER_ADMIN')) {
    return { result: 'SUPER_ADMIN_REQUIRED' };
  }

  const claimed = await db.aiAction.updateMany({
    where: { id: action.id, status: 'PENDING_APPROVAL' },
    data: {
      status: 'APPROVED',
      approvedByUserId: params.actor.userId,
      approvedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    return { result: 'NOT_PENDING', currentStatus: 'ALREADY_DECIDED' };
  }

  await writeAudit(db, {
    action: AUDIT_ACTIONS.AI_ACTION_APPROVED,
    entityType: 'AiAction',
    entityId: action.id,
    actorUserId: params.actor.userId,
    severity: 'CRITICAL',
    afterState: { toolName: action.toolName, riskTier: action.riskTier },
    ...params.context,
  });

  try {
    const output = await executeTool(action.toolName, action.requestedPayload, {
      // The approver is the acting identity: they authorised this.
      actor: params.actor,
      db,
      aiRunId: action.aiRunId,
      requestContext: params.context,
    });

    await db.aiAction.update({
      where: { id: action.id },
      data: {
        status: 'EXECUTED',
        executedAt: new Date(),
        resultPayload: redactForStorage(output),
      },
    });

    await writeAudit(db, {
      action: AUDIT_ACTIONS.AI_ACTION_EXECUTED,
      entityType: 'AiAction',
      entityId: action.id,
      actorUserId: params.actor.userId,
      severity: 'CRITICAL',
      afterState: { toolName: action.toolName },
      ...params.context,
    });

    return { result: 'EXECUTED', actionId: action.id, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool execution failed.';

    await db.aiAction.update({
      where: { id: action.id },
      data: { status: 'FAILED', errorCode: 'TOOL_FAILED', errorMessage: message },
    });

    return { result: 'EXECUTION_FAILED', actionId: action.id, message };
  }
}

/** Reject a held action. It can never execute afterwards. */
export async function rejectAction(
  params: { actor: Actor; actionId: string; reason: string; context?: RequestContext },
  db: Db = prisma,
): Promise<ApprovalOutcome> {
  assertAuthorized(params.actor, 'ai:approve:any');

  const rejected = await db.aiAction.updateMany({
    where: { id: params.actionId, status: 'PENDING_APPROVAL' },
    data: {
      status: 'REJECTED',
      approvedByUserId: params.actor.userId,
      approvedAt: new Date(),
      rejectedReason: params.reason,
    },
  });

  if (rejected.count === 0) {
    const existing = await db.aiAction.findUnique({
      where: { id: params.actionId },
      select: { status: true },
    });
    return existing
      ? { result: 'NOT_PENDING', currentStatus: existing.status }
      : { result: 'NOT_FOUND' };
  }

  await writeAudit(db, {
    action: AUDIT_ACTIONS.AI_ACTION_REJECTED,
    entityType: 'AiAction',
    entityId: params.actionId,
    actorUserId: params.actor.userId,
    severity: 'NOTICE',
    afterState: { reason: params.reason },
    ...params.context,
  });

  return { result: 'REJECTED', actionId: params.actionId };
}

/** Expire stale held actions so the queue does not accumulate forever. */
export async function expireStaleApprovals(
  params: { olderThanMs: number },
  db: Db = prisma,
): Promise<number> {
  const cutoff = new Date(Date.now() - params.olderThanMs);
  const expired = await db.aiAction.updateMany({
    where: { status: 'PENDING_APPROVAL', createdAt: { lt: cutoff } },
    data: { status: 'EXPIRED' },
  });
  return expired.count;
}

/**
 * AI operations (Phase 8): observing what the agents did, and the kill switch.
 *
 * Observation is read-only. It adds the views Phase 7 did not have — the action
 * log, recommendations, usage and cost by agent, policy decisions, approval
 * outcomes, recent failures — next to the existing run log, run detail, health
 * and approval queue (`services/ai/observability-service.ts`,
 * `services/ai/approval-service.ts`), which are reused rather than duplicated.
 *
 * Viewing grants nothing. No function here changes an action's status, risk
 * tier, policy decision or payload. Approving a held action still goes only
 * through `approveAction`, with its RBAC, MFA, CRITICAL→SUPER_ADMIN rule and the
 * database CHECK that refuses an unapproved HIGH/CRITICAL execution.
 *
 * The kill switch is deliberately asymmetric. Disabling an agent removes
 * capability, so an administrator who may approve AI actions may do it at once.
 * Enabling restores capability, so it needs a super administrator.
 */

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import { assertCapability, normalizeReason } from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import type { AI_ACTION_STATUSES, AI_RISK_TIERS, RECOMMENDATION_STATUSES } from '../../lib/validation/admin';
import type { AgentKey } from '../../ai/agents/definitions';
import { setAgentEnabled } from '../../ai/runtime/agent-sync';
import { executeAdminMutation } from './admin-mutation';
import { type AdminOutcome, AdminRejection, lockRow, rejectedOutcome, severityFor } from './outcome';
import { type Page, type PageRequest, iso, minor, newestFirst, pageSize, toPage } from './pagination';

type AiActionStatus = (typeof AI_ACTION_STATUSES)[number];
type AiRiskTier = (typeof AI_RISK_TIERS)[number];
type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

const FAILED_RUN_STATUSES = ['FAILED', 'TIMED_OUT', 'VALIDATION_FAILED'] as const;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface AdminAiAction {
  readonly actionId: string;
  readonly aiRunId: string;
  readonly agentKey: string;
  readonly toolName: string;
  readonly riskTier: string;
  readonly status: string;
  readonly policyDecision: string | null;
  readonly policyReason: string | null;
  readonly requiresHumanApproval: boolean;
  readonly approvedByUserId: string | null;
  readonly approvedAt: string | null;
  readonly rejectedReason: string | null;
  readonly executedAt: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly projectId: string | null;
  readonly createdAt: string;
}

/**
 * The action log. Payloads are left out of the list; the full request and
 * result of one run are in the run detail view.
 */
export async function listAiActions(
  params: PageRequest & {
    readonly actor: Actor;
    readonly status?: AiActionStatus | undefined;
    readonly riskTier?: AiRiskTier | undefined;
    readonly toolName?: string | undefined;
    readonly failedOnly?: boolean | undefined;
  },
  db: Db = prisma,
): Promise<Page<AdminAiAction>> {
  assertCapability(params.actor, 'AI_READ');
  const size = pageSize(params.limit);
  const status = params.failedOnly ? 'FAILED' : params.status;

  const rows = await db.aiAction.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(params.riskTier ? { riskTier: params.riskTier } : {}),
      ...(params.toolName ? { toolName: params.toolName } : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: {
      id: true,
      aiRunId: true,
      toolName: true,
      riskTier: true,
      status: true,
      policyDecision: true,
      policyReason: true,
      requiresHumanApproval: true,
      approvedByUserId: true,
      approvedAt: true,
      rejectedReason: true,
      executedAt: true,
      errorCode: true,
      errorMessage: true,
      entityType: true,
      entityId: true,
      createdAt: true,
      aiRun: { select: { projectId: true, agent: { select: { key: true } } } },
    },
  });

  return toPage(rows, size, (row) => ({
    actionId: row.id,
    aiRunId: row.aiRunId,
    agentKey: row.aiRun.agent.key,
    toolName: row.toolName,
    riskTier: row.riskTier,
    status: row.status,
    policyDecision: row.policyDecision,
    policyReason: row.policyReason,
    requiresHumanApproval: row.requiresHumanApproval,
    approvedByUserId: row.approvedByUserId,
    approvedAt: iso(row.approvedAt),
    rejectedReason: row.rejectedReason,
    executedAt: iso(row.executedAt),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    entityType: row.entityType,
    entityId: row.entityId,
    projectId: row.aiRun.projectId,
    createdAt: row.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export interface AdminAiRecommendation {
  readonly recommendationId: string;
  readonly projectId: string;
  readonly expertId: string | null;
  readonly teamId: string | null;
  readonly aiRunId: string;
  readonly agentKey: string;
  readonly status: string;
  readonly rank: number;
  /** Basis points (0..10000), as stored. */
  readonly overallScore: number;
  readonly scores: Readonly<Record<string, number | null>>;
  readonly rationale: string | null;
  readonly evidence: unknown;
  readonly presentedAt: string | null;
  readonly decidedByUserId: string | null;
  readonly decidedAt: string | null;
  /** Set when a human chose differently from the ranking. */
  readonly overriddenReason: string | null;
  readonly createdAt: string;
}

export async function listAiRecommendations(
  params: PageRequest & {
    readonly actor: Actor;
    readonly status?: RecommendationStatus | undefined;
    readonly projectId?: string | undefined;
  },
  db: Db = prisma,
): Promise<Page<AdminAiRecommendation>> {
  assertCapability(params.actor, 'AI_READ');
  const size = pageSize(params.limit);

  const rows = await db.recommendation.findMany({
    where: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...newestFirst(params.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: {
      id: true,
      projectId: true,
      expertId: true,
      teamId: true,
      aiRunId: true,
      status: true,
      rank: true,
      overallScore: true,
      skillScore: true,
      experienceScore: true,
      similarProjectScore: true,
      availabilityScore: true,
      budgetFitScore: true,
      ratingScore: true,
      pastPerformanceScore: true,
      onTimePerformanceScore: true,
      clientSatisfactionScore: true,
      responseTimeScore: true,
      certificationScore: true,
      rationale: true,
      evidence: true,
      presentedAt: true,
      decidedByUserId: true,
      decidedAt: true,
      overriddenReason: true,
      createdAt: true,
      aiRun: { select: { agent: { select: { key: true } } } },
    },
  });

  return toPage(rows, size, (row) => ({
    recommendationId: row.id,
    projectId: row.projectId,
    expertId: row.expertId,
    teamId: row.teamId,
    aiRunId: row.aiRunId,
    agentKey: row.aiRun.agent.key,
    status: row.status,
    rank: row.rank,
    overallScore: row.overallScore,
    scores: {
      skill: row.skillScore,
      experience: row.experienceScore,
      similarProject: row.similarProjectScore,
      availability: row.availabilityScore,
      budgetFit: row.budgetFitScore,
      rating: row.ratingScore,
      pastPerformance: row.pastPerformanceScore,
      onTimePerformance: row.onTimePerformanceScore,
      clientSatisfaction: row.clientSatisfactionScore,
      responseTime: row.responseTimeScore,
      certification: row.certificationScore,
    },
    rationale: row.rationale,
    evidence: row.evidence,
    presentedAt: iso(row.presentedAt),
    decidedByUserId: row.decidedByUserId,
    decidedAt: iso(row.decidedAt),
    overriddenReason: row.overriddenReason,
    createdAt: row.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Overview — usage, cost, policy, approvals, failures
// ---------------------------------------------------------------------------

export interface AiOperationsOverview {
  readonly since: string;
  readonly agents: readonly {
    readonly agentKey: string;
    readonly name: string;
    readonly isEnabled: boolean;
    readonly runs: number;
    readonly runsByStatus: Readonly<Record<string, number>>;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cost: readonly { readonly currency: string | null; readonly costMinor: string }[];
  }[];
  readonly actions: {
    readonly byStatus: readonly { readonly status: string; readonly count: number }[];
    readonly byPolicyDecision: readonly { readonly policyDecision: string | null; readonly count: number }[];
    readonly byRiskTier: readonly { readonly riskTier: string; readonly count: number }[];
  };
  readonly approvals: {
    /** Waiting now, regardless of age. */
    readonly pending: number;
    readonly approved: number;
    readonly rejected: number;
    readonly expired: number;
  };
  readonly recentFailures: readonly {
    readonly runId: string;
    readonly agentKey: string;
    readonly status: string;
    readonly errorCode: string | null;
    readonly createdAt: string;
  }[];
}

export async function getAiOperationsOverview(
  params: { readonly actor: Actor; readonly sinceHours?: number | undefined },
  db: Db = prisma,
): Promise<AiOperationsOverview> {
  assertCapability(params.actor, 'AI_READ');

  const since = new Date(Date.now() - (params.sinceHours ?? 24 * 30) * 60 * 60 * 1000);
  const inWindow = { createdAt: { gte: since } };

  const [agents, runGroups, costGroups, actionStatus, policy, risk, pending, approved, rejected, expired, failures] =
    await Promise.all([
      db.aiAgent.findMany({ orderBy: { key: 'asc' }, select: { id: true, key: true, name: true, isEnabled: true } }),
      db.aiRun.groupBy({
        by: ['agentId', 'status'],
        where: inWindow,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      db.aiRun.groupBy({ by: ['agentId', 'currency'], where: inWindow, _sum: { costMinor: true } }),
      db.aiAction.groupBy({ by: ['status'], where: inWindow, _count: { _all: true } }),
      db.aiAction.groupBy({ by: ['policyDecision'], where: inWindow, _count: { _all: true } }),
      db.aiAction.groupBy({ by: ['riskTier'], where: inWindow, _count: { _all: true } }),
      db.aiAction.count({ where: { status: 'PENDING_APPROVAL', requiresHumanApproval: true } }),
      db.aiAction.count({
        where: { ...inWindow, requiresHumanApproval: true, approvedByUserId: { not: null }, status: { in: ['APPROVED', 'EXECUTED', 'FAILED'] } },
      }),
      db.aiAction.count({ where: { ...inWindow, requiresHumanApproval: true, status: 'REJECTED' } }),
      db.aiAction.count({ where: { ...inWindow, status: 'EXPIRED' } }),
      db.aiRun.findMany({
        where: { ...inWindow, status: { in: [...FAILED_RUN_STATUSES] } },
        orderBy: { id: 'desc' },
        take: 20,
        select: { id: true, status: true, errorCode: true, createdAt: true, agent: { select: { key: true } } },
      }),
    ]);

  return {
    since: since.toISOString(),
    agents: agents.map((agent) => {
      const runs = runGroups.filter((group) => group.agentId === agent.id);
      return {
        agentKey: agent.key,
        name: agent.name,
        isEnabled: agent.isEnabled,
        runs: runs.reduce((sum, group) => sum + group._count._all, 0),
        runsByStatus: Object.fromEntries(runs.map((group) => [group.status, group._count._all])),
        inputTokens: runs.reduce((sum, group) => sum + (group._sum.inputTokens ?? 0), 0),
        outputTokens: runs.reduce((sum, group) => sum + (group._sum.outputTokens ?? 0), 0),
        cost: costGroups
          .filter((group) => group.agentId === agent.id && group._sum.costMinor !== null)
          .map((group) => ({ currency: group.currency, costMinor: minor(group._sum.costMinor) ?? '0' })),
      };
    }),
    actions: {
      byStatus: actionStatus.map((group) => ({ status: group.status, count: group._count._all })),
      byPolicyDecision: policy.map((group) => ({ policyDecision: group.policyDecision, count: group._count._all })),
      byRiskTier: risk.map((group) => ({ riskTier: group.riskTier, count: group._count._all })),
    },
    approvals: { pending, approved, rejected, expired },
    recentFailures: failures.map((run) => ({
      runId: run.id,
      agentKey: run.agent.key,
      status: run.status,
      errorCode: run.errorCode,
      createdAt: run.createdAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

export interface AgentStatusRequest {
  readonly actor: Actor;
  readonly agentKey: AgentKey;
  readonly enabled: boolean;
  readonly reason?: string | undefined;
  readonly confirm?: boolean | undefined;
  readonly context?: RequestContext | undefined;
}

/**
 * Disable (ADMIN or SUPER_ADMIN) or enable (SUPER_ADMIN) an agent. A disabled
 * agent's runs are cancelled and its tool calls refused by the policy engine.
 */
export async function setAgentStatus(request: AgentStatusRequest, db: Db = prisma): Promise<AdminOutcome> {
  const event = request.enabled ? 'ENABLE' : 'DISABLE';
  // Agent keys are a published enum, so resolving one reveals nothing.
  const agent = await db.aiAgent.findUnique({ where: { key: request.agentKey }, select: { id: true } });
  if (!agent) {
    return rejectedOutcome(
      { entityType: 'AiAgent', entityId: null, event },
      new AdminRejection('NOT_FOUND', 'No agent with that key.'),
    );
  }

  const risk = request.enabled ? 'HIGH' : 'MEDIUM';

  return executeAdminMutation(
    {
      entityType: 'AiAgent',
      entityId: agent.id,
      event,
      actor: request.actor,
      capability: request.enabled ? 'AI_AGENT_ENABLE' : 'AI_AGENT_DISABLE',
      risk,
      justification: { reason: request.reason, confirm: request.confirm },
      context: request.context,
      async run(tx, base) {
        await lockRow(tx, 'ai_agents', agent.id);
        const current = await tx.aiAgent.findUnique({ where: { id: agent.id }, select: { isEnabled: true } });
        if (!current) throw new AdminRejection('NOT_FOUND', 'No agent with that key.');

        const status = (enabled: boolean): string => (enabled ? 'ENABLED' : 'DISABLED');
        if (current.isEnabled === request.enabled) {
          return { ...base, result: 'NO_OP', status: status(current.isEnabled) };
        }

        await setAgentEnabled(tx, request.agentKey, request.enabled);

        await writeAudit(tx, {
          action: AUDIT_ACTIONS.ADMIN_AI_AGENT_STATUS_CHANGED,
          entityType: 'AiAgent',
          entityId: agent.id,
          actorUserId: request.actor.userId,
          severity: severityFor(risk),
          beforeState: { isEnabled: current.isEnabled },
          afterState: { isEnabled: request.enabled, agentKey: request.agentKey, reason: normalizeReason(request.reason) },
          ...request.context,
        });

        return {
          ...base,
          result: 'APPLIED',
          from: status(current.isEnabled),
          to: status(request.enabled),
          cascades: [],
        };
      },
    },
    db,
  );
}

/**
 * Admin AI observability.
 *
 * Backs `/admin/ai/*`. Every query is gated on `ai:read:any`, which only the
 * privileged roles hold — and those roles are MFA-gated, so AI run payloads
 * cannot be read from an un-challenged session.
 *
 * This is what makes master spec §34 answerable in practice: for any
 * recommendation, which agent, which version, which model, what it cost, what it
 * proposed, whether a human overrode it, and who approved.
 */

import { type Actor, assertAuthorized } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';

export interface AiRunSummary {
  readonly runId: string;
  readonly agentKey: string;
  readonly agentVersion: string | null;
  readonly model: string;
  readonly provider: string;
  readonly status: string;
  readonly validationStatus: string;
  readonly latencyMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costMinor: string | null;
  readonly currency: string | null;
  readonly projectId: string | null;
  readonly triggeredByUserId: string | null;
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly actionCount: number;
}

export async function listRuns(
  params: {
    actor: Actor;
    // `| undefined` so callers may spread an optional-property object under
    // exactOptionalPropertyTypes.
    agentKey?: string | undefined;
    status?: string | undefined;
    projectId?: string | undefined;
    limit?: number | undefined;
  },
  db: Db = prisma,
): Promise<readonly AiRunSummary[]> {
  assertAuthorized(params.actor, 'ai:read:any');

  const runs = await db.aiRun.findMany({
    where: {
      ...(params.agentKey ? { agent: { key: params.agentKey as never } } : {}),
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.projectId ? { projectId: params.projectId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(params.limit ?? 50, 200),
    select: {
      id: true,
      model: true,
      provider: true,
      status: true,
      validationStatus: true,
      latencyMs: true,
      inputTokens: true,
      outputTokens: true,
      costMinor: true,
      currency: true,
      projectId: true,
      triggeredByUserId: true,
      errorCode: true,
      createdAt: true,
      agent: { select: { key: true } },
      agentVersion: { select: { version: true } },
      _count: { select: { actions: true } },
    },
  });

  return runs.map((run) => ({
    runId: run.id,
    agentKey: run.agent.key,
    agentVersion: run.agentVersion?.version ?? null,
    model: run.model,
    provider: run.provider,
    status: run.status,
    validationStatus: run.validationStatus,
    latencyMs: run.latencyMs,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    // BigInt is not JSON-serialisable; strings keep the exact minor-unit value.
    costMinor: run.costMinor?.toString() ?? null,
    currency: run.currency,
    projectId: run.projectId,
    triggeredByUserId: run.triggeredByUserId,
    errorCode: run.errorCode,
    createdAt: run.createdAt.toISOString(),
    actionCount: run._count.actions,
  }));
}

/** Full detail for one run, including every proposed action. */
export async function getRunDetail(
  params: { actor: Actor; runId: string },
  db: Db = prisma,
): Promise<unknown> {
  assertAuthorized(params.actor, 'ai:read:any');

  const run = await db.aiRun.findUnique({
    where: { id: params.runId },
    select: {
      id: true,
      model: true,
      provider: true,
      status: true,
      validationStatus: true,
      validationErrors: true,
      inputPayload: true,
      outputPayload: true,
      latencyMs: true,
      inputTokens: true,
      outputTokens: true,
      cachedInputTokens: true,
      costMinor: true,
      currency: true,
      errorCode: true,
      errorMessage: true,
      retryCount: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      agent: { select: { key: true, name: true } },
      agentVersion: { select: { version: true, promptRef: true, promptHash: true } },
      actions: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
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
          requestedPayload: true,
          resultPayload: true,
          createdAt: true,
        },
      },
    },
  });

  if (!run) return null;

  return { ...run, costMinor: run.costMinor?.toString() ?? null };
}

export interface AiHealthMetrics {
  readonly totalRuns: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly validationFailed: number;
  /** Basis points, so no float appears in a reported metric. */
  readonly successRateBasisPoints: number;
  readonly totalCostMinor: string;
  readonly currency: string;
  readonly pendingApprovals: number;
  readonly recommendationsProposed: number;
  readonly recommendationsAccepted: number;
  readonly recommendationsDeclined: number;
  /** Acceptance and override rates, both in basis points. */
  readonly matchAcceptanceBasisPoints: number;
  readonly humanOverrideBasisPoints: number;
}

/**
 * The AI health panel from STEP 01 §9.1: match acceptance, human override rate,
 * failure rate and cost.
 */
export async function getHealthMetrics(
  params: { actor: Actor; sinceMs?: number },
  db: Db = prisma,
): Promise<AiHealthMetrics> {
  assertAuthorized(params.actor, 'ai:read:any');

  const since = new Date(Date.now() - (params.sinceMs ?? 30 * 24 * 60 * 60 * 1000));
  const where = { createdAt: { gte: since } };

  const [
    totalRuns,
    succeeded,
    failed,
    validationFailed,
    pendingApprovals,
    costAggregate,
    proposed,
    accepted,
    declined,
  ] = await Promise.all([
    db.aiRun.count({ where }),
    db.aiRun.count({ where: { ...where, status: 'SUCCEEDED' } }),
    db.aiRun.count({ where: { ...where, status: 'FAILED' } }),
    db.aiRun.count({ where: { ...where, status: 'VALIDATION_FAILED' } }),
    db.aiAction.count({ where: { status: 'PENDING_APPROVAL' } }),
    db.aiRun.aggregate({ where, _sum: { costMinor: true } }),
    db.recommendation.count({ where }),
    db.recommendation.count({ where: { ...where, status: 'ACCEPTED' } }),
    db.recommendation.count({ where: { ...where, status: 'DECLINED' } }),
  ]);

  const decided = accepted + declined;

  return {
    totalRuns,
    succeeded,
    failed,
    validationFailed,
    successRateBasisPoints: totalRuns === 0 ? 0 : Math.round((succeeded / totalRuns) * 10_000),
    totalCostMinor: (costAggregate._sum.costMinor ?? 0n).toString(),
    currency: 'USD',
    pendingApprovals,
    recommendationsProposed: proposed,
    recommendationsAccepted: accepted,
    recommendationsDeclined: declined,
    matchAcceptanceBasisPoints: decided === 0 ? 0 : Math.round((accepted / decided) * 10_000),
    // A declined recommendation is a human overriding the agent's ranking.
    humanOverrideBasisPoints: decided === 0 ? 0 : Math.round((declined / decided) * 10_000),
  };
}

/** Registry view for `/admin/ai/agents`. */
export async function listAgents(
  params: { actor: Actor },
  db: Db = prisma,
): Promise<unknown> {
  assertAuthorized(params.actor, 'ai:read:any');

  return db.aiAgent.findMany({
    orderBy: { key: 'asc' },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      defaultRiskTier: true,
      isEnabled: true,
      versions: {
        orderBy: { releasedAt: 'desc' },
        select: {
          version: true,
          model: true,
          provider: true,
          promptRef: true,
          isActive: true,
          releasedAt: true,
        },
      },
      _count: { select: { runs: true } },
    },
  });
}

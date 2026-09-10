/**
 * AI orchestration integration tests.
 *
 * Exercises the whole controlled path against real PostgreSQL, with the provider
 * replaced by `FakeProvider` — so every assertion is exact and no live AI
 * dependency exists, as Phase 7 requires.
 *
 * Skips cleanly when no database is reachable.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Actor } from '../../lib/authz/authorize';
import { prisma } from '../../lib/db/client';
import { runAgent } from '../../ai/runtime/orchestrator';
import { syncAllAgents } from '../../ai/runtime/agent-sync';
import { FakeProvider, ProviderError, resetProviderCache, setProviderOverride } from '../../ai/providers';
import { approveAction, listPendingApprovals, rejectAction } from '../../services/ai/approval-service';
import { getHealthMetrics, getRunDetail } from '../../services/ai/observability-service';

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const databaseAvailable = await checkDatabase();
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let customerUserId = '';
let adminUserId = '';
let superAdminUserId = '';
let projectId = '';
let expertId = '';

const fake = new FakeProvider();

function adminActor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: adminUserId,
    roles: ['ADMIN'],
    mfaSatisfied: true,
    accountActive: true,
    ...overrides,
  };
}

beforeAll(async () => {
  if (!databaseAvailable) return;

  setProviderOverride(fake);
  await syncAllAgents(prisma);

  const makeUser = async (label: string): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        email: `aitest-${label}-${stamp}@example.test`,
        fullName: `AI Test ${label}`,
        status: 'ACTIVE',
        emailVerified: new Date(),
      },
      select: { id: true },
    });
    return user.id;
  };

  customerUserId = await makeUser('customer');
  adminUserId = await makeUser('admin');
  superAdminUserId = await makeUser('superadmin');

  const customer = await prisma.customerProfile.create({
    data: { userId: customerUserId },
    select: { id: true },
  });

  const category = await prisma.category.create({
    data: { name: `AI Cat ${stamp}`, slug: `ai-cat-${stamp}` },
    select: { id: true },
  });

  const project = await prisma.project.create({
    data: {
      projectNumber: `PRJ-AI-${stamp}`,
      customerId: customer.id,
      source: 'POSTED_PROJECT',
      status: 'AI_ANALYSIS',
      title: 'Rebuild the account portal',
      description: 'Replace the legacy account area. Reach me at leak@example.com or 9876543210.',
      categoryId: category.id,
      currency: 'INR',
    },
    select: { id: true },
  });
  projectId = project.id;

  const expertUserId = await makeUser('expert');
  const expert = await prisma.expertProfile.create({
    data: {
      userId: expertUserId,
      slug: `ai-expert-${stamp}`,
      headline: 'Full-stack engineer',
      yearsOfExperience: 8,
      hourlyRateMinor: 350_000n,
      currency: 'INR',
      isAcceptingWork: true,
      verificationStatus: 'VERIFIED',
      availabilityStatus: 'AVAILABLE',
    },
    select: { id: true },
  });
  expertId = expert.id;
}, 120_000);

afterEach(() => {
  fake.reset();
});

afterAll(async () => {
  if (databaseAvailable) {
    await prisma.aiRun.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({
      where: { email: { contains: `-${stamp}@example.test` } },
    });
  }
  setProviderOverride(null);
  resetProviderCache();
  await prisma.$disconnect();
});

describe.skipIf(!databaseAvailable)('successful run persistence', () => {
  it('records agent, version, model, tokens, cost and latency', async () => {
    fake.pushOutput(
      {
        findings: [],
        flagCount: 0,
        recommendationForReviewer: 'LOOKS_CONSISTENT',
        confidence: 'HIGH',
      },
      { inputTokens: 120, outputTokens: 45 },
    );

    const result = await runAgent({
      agentKey: 'VERIFICATION',
      input: { expertId },
      actor: adminActor(),
      entityType: 'ExpertProfile',
      entityId: expertId,
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.costMinor).toBe(165n); // fake pricing: input + output tokens

    const run = await prisma.aiRun.findUniqueOrThrow({
      where: { id: result.runId },
      select: {
        status: true,
        model: true,
        provider: true,
        inputTokens: true,
        outputTokens: true,
        costMinor: true,
        currency: true,
        latencyMs: true,
        validationStatus: true,
        completedAt: true,
        agent: { select: { key: true } },
        agentVersion: { select: { version: true, promptHash: true } },
      },
    });

    expect(run.status).toBe('SUCCEEDED');
    expect(run.agent.key).toBe('VERIFICATION');
    expect(run.agentVersion?.version).toBe('1.0.0');
    expect(run.agentVersion?.promptHash).toBeTruthy();
    expect(run.inputTokens).toBe(120);
    expect(run.outputTokens).toBe(45);
    expect(run.costMinor).toBe(165n);
    expect(run.validationStatus).toBe('PASSED');
    expect(run.latencyMs).toBeGreaterThanOrEqual(0);
    expect(run.completedAt).not.toBeNull();
  });

  it('answers the traceability question for any run', async () => {
    fake.pushOutput({
      findings: [],
      flagCount: 0,
      recommendationForReviewer: 'LOOKS_CONSISTENT',
      confidence: 'HIGH',
    });

    const result = await runAgent({
      agentKey: 'VERIFICATION',
      input: { expertId },
      actor: adminActor(),
    });

    const detail = (await getRunDetail({ actor: adminActor(), runId: result.runId })) as Record<
      string,
      unknown
    >;

    // Which agent, which version, which model, which prompt.
    expect(detail.agent).toMatchObject({ key: 'VERIFICATION' });
    expect(detail.agentVersion).toMatchObject({ version: '1.0.0' });
    expect(detail.model).toBeTruthy();
    expect(detail.provider).toBe('anthropic');
  });
});

describe.skipIf(!databaseAvailable)('output validation', () => {
  it('marks a schema-invalid output VALIDATION_FAILED and writes no output', async () => {
    fake.pushOutput({ nonsense: true });

    const result = await runAgent({
      agentKey: 'VERIFICATION',
      input: { expertId },
      actor: adminActor(),
    });

    expect(result.status).toBe('VALIDATION_FAILED');
    expect(result.errorCode).toBe('AGENT_OUTPUT_INVALID');

    const run = await prisma.aiRun.findUniqueOrThrow({
      where: { id: result.runId },
      select: { status: true, outputPayload: true, validationStatus: true, validationErrors: true },
    });

    // The important part: nothing half-understood reached the database.
    expect(run.status).toBe('VALIDATION_FAILED');
    expect(run.outputPayload).toBeNull();
    expect(run.validationStatus).toBe('FAILED');
    expect(run.validationErrors).not.toBeNull();
  });

  it('rejects invalid agent input before spending a token', async () => {
    const result = await runAgent({
      agentKey: 'VERIFICATION',
      input: { wrongField: 1 },
      actor: adminActor(),
    });

    expect(result.status).toBe('VALIDATION_FAILED');
    expect(result.errorCode).toBe('AGENT_INPUT_INVALID');
    expect(fake.callCount).toBe(0);
  });
});

describe.skipIf(!databaseAvailable)('privacy and prompt-injection boundaries', () => {
  it('redacts PII before it reaches the provider', async () => {
    fake.pushOutput({
      overallProgressPercent: 10,
      onTrack: true,
      observations: [],
      blockedItems: [],
    });

    await runAgent({
      agentKey: 'EXECUTION',
      input: { projectId },
      actor: adminActor(),
      projectId,
    });

    const sent = JSON.stringify(fake.lastRequest()?.input ?? {});
    expect(sent).not.toContain('leak@example.com');
    expect(sent).not.toContain('9876543210');
  });

  it('redacts PII before it is persisted', async () => {
    fake.pushOutput({
      overallProgressPercent: 10,
      onTrack: true,
      observations: [],
      blockedItems: [],
    });

    const result = await runAgent({
      agentKey: 'EXECUTION',
      // Untrusted content arriving with the request.
      input: { projectId, note: 'contact billing@example.com' } as never,
      actor: adminActor(),
      projectId,
    });

    const run = await prisma.aiRun.findUniqueOrThrow({
      where: { id: result.runId },
      select: { inputPayload: true },
    });
    expect(JSON.stringify(run.inputPayload)).not.toContain('billing@example.com');
  });

  it('never places user content in the system prompt', async () => {
    fake.pushOutput({
      overallProgressPercent: 0,
      onTrack: true,
      observations: [],
      blockedItems: [],
    });

    await runAgent({
      agentKey: 'EXECUTION',
      input: { projectId },
      actor: adminActor(),
      projectId,
    });

    const request = fake.lastRequest()!;
    // Instructions and data are separated, so injected text lands in data.
    expect(request.system).toContain('untrusted data');
    expect(request.system).not.toContain(projectId);
  });

  it('offers the model only the tools its agent is allow-listed for', async () => {
    fake.pushOutput({
      findings: [],
      flagCount: 0,
      recommendationForReviewer: 'LOOKS_CONSISTENT',
      confidence: 'HIGH',
    });

    await runAgent({ agentKey: 'VERIFICATION', input: { expertId }, actor: adminActor() });

    const offered = (fake.lastRequest()?.tools ?? []).map((tool) => tool.name);
    expect(offered).toEqual(['getExpertProfile']);
  });
});

describe.skipIf(!databaseAvailable)('tool execution and the policy gate', () => {
  it('executes a LOW-risk tool inline and records the action', async () => {
    fake.pushToolCalls([{ id: 'call-1', name: 'getExpertProfile', input: { expertId } }]);
    fake.pushOutput({
      findings: [],
      flagCount: 0,
      recommendationForReviewer: 'LOOKS_CONSISTENT',
      confidence: 'HIGH',
    });

    const result = await runAgent({
      agentKey: 'VERIFICATION',
      input: { expertId },
      actor: adminActor(),
    });

    expect(result.status).toBe('SUCCEEDED');

    const action = await prisma.aiAction.findFirstOrThrow({
      where: { aiRunId: result.runId, toolName: 'getExpertProfile' },
      select: { status: true, riskTier: true, policyDecision: true, executedAt: true, resultPayload: true },
    });

    expect(action.status).toBe('EXECUTED');
    expect(action.riskTier).toBe('LOW');
    expect(action.policyDecision).toBe('ALLOW');
    expect(action.executedAt).not.toBeNull();
    expect(action.resultPayload).not.toBeNull();
  });

  it('records a denied tool call rather than silently dropping it', async () => {
    // The verification agent is not allow-listed for searchExperts.
    fake.pushToolCalls([{ id: 'call-2', name: 'searchExperts', input: { limit: 5 } }]);
    fake.pushOutput({
      findings: [],
      flagCount: 0,
      recommendationForReviewer: 'LOOKS_CONSISTENT',
      confidence: 'HIGH',
    });

    const result = await runAgent({
      agentKey: 'VERIFICATION',
      input: { expertId },
      actor: adminActor(),
    });

    const action = await prisma.aiAction.findFirstOrThrow({
      where: { aiRunId: result.runId, toolName: 'searchExperts' },
      select: { status: true, policyDecision: true, policyReason: true, executedAt: true },
    });

    // The audit trail shows what the agent WANTED to do, not only what it did.
    expect(action.status).toBe('REJECTED');
    expect(action.policyDecision).toBe('DENY');
    expect(action.policyReason).toContain('not allow-listed');
    expect(action.executedAt).toBeNull();
  });

  it('holds a HIGH-risk tool for human approval instead of executing it', async () => {
    fake.pushToolCalls([
      { id: 'call-3', name: 'createAssignmentDraft', input: { projectId, expertId } },
    ]);

    const result = await runAgent({
      agentKey: 'MATCHING',
      input: { projectId, candidateExpertIds: [expertId] },
      actor: adminActor(),
      projectId,
    });

    expect(result.pendingApprovals).toHaveLength(1);
    expect(result.pendingApprovals[0]).toMatchObject({
      toolName: 'createAssignmentDraft',
      riskTier: 'HIGH',
      requiresSuperAdmin: false,
    });

    const action = await prisma.aiAction.findFirstOrThrow({
      where: { aiRunId: result.runId, toolName: 'createAssignmentDraft' },
      select: { status: true, requiresHumanApproval: true, executedAt: true },
    });
    expect(action.status).toBe('PENDING_APPROVAL');
    expect(action.requiresHumanApproval).toBe(true);
    expect(action.executedAt).toBeNull();

    // And crucially: no assignment was created.
    const assignments = await prisma.assignment.count({ where: { projectId, expertId } });
    expect(assignments).toBe(0);
  });
});

describe.skipIf(!databaseAvailable)('human-in-the-loop approval', () => {
  async function heldAction(): Promise<string> {
    fake.pushToolCalls([
      { id: `call-${Math.random()}`, name: 'createAssignmentDraft', input: { projectId, expertId } },
    ]);
    const result = await runAgent({
      agentKey: 'MATCHING',
      input: { projectId, candidateExpertIds: [expertId] },
      actor: adminActor(),
      projectId,
    });
    return result.pendingApprovals[0]!.actionId;
  }

  it('surfaces held actions in the approval queue', async () => {
    const actionId = await heldAction();
    const pending = await listPendingApprovals({ actor: adminActor() });
    expect(pending.map((entry) => entry.actionId)).toContain(actionId);
  });

  it('executes the action only when a human approves it', async () => {
    const actionId = await heldAction();

    const before = await prisma.assignment.count({ where: { projectId } });
    const outcome = await approveAction({ actor: adminActor(), actionId });

    expect(outcome.result).toBe('EXECUTED');
    expect(await prisma.assignment.count({ where: { projectId } })).toBe(before + 1);

    const action = await prisma.aiAction.findUniqueOrThrow({
      where: { id: actionId },
      select: { status: true, approvedByUserId: true, executedAt: true },
    });
    expect(action.status).toBe('EXECUTED');
    expect(action.approvedByUserId).toBe(adminUserId);
    expect(action.executedAt).not.toBeNull();
  });

  it('refuses a caller without the approval permission', async () => {
    const actionId = await heldAction();
    const customer: Actor = {
      userId: customerUserId,
      roles: ['CUSTOMER'],
      mfaSatisfied: true,
      accountActive: true,
    };

    await expect(approveAction({ actor: customer, actionId })).rejects.toThrow(
      /Authorization denied/,
    );

    const action = await prisma.aiAction.findUniqueOrThrow({
      where: { id: actionId },
      select: { status: true },
    });
    expect(action.status).toBe('PENDING_APPROVAL');
  });

  it('refuses an approver who has not satisfied MFA', async () => {
    const actionId = await heldAction();
    await expect(
      approveAction({ actor: adminActor({ mfaSatisfied: false }), actionId }),
    ).rejects.toThrow(/MFA_REQUIRED/);
  });

  it('cannot be approved twice', async () => {
    const actionId = await heldAction();
    await approveAction({ actor: adminActor(), actionId });

    const second = await approveAction({ actor: adminActor(), actionId });
    expect(second.result).toBe('NOT_PENDING');
  });

  it('refuses a CRITICAL action to anyone but a super administrator', async () => {
    // No CRITICAL tool is registered today, so the row is created directly to
    // exercise the branch that guards the financial/account tier.
    const run = await prisma.aiRun.findFirstOrThrow({
      where: { projectId },
      select: { id: true },
    });

    const critical = await prisma.aiAction.create({
      data: {
        aiRunId: run.id,
        toolName: 'getProjectContext',
        riskTier: 'CRITICAL',
        requestedPayload: { projectId },
        status: 'PENDING_APPROVAL',
        requiresHumanApproval: true,
        policyDecision: 'REQUIRE_APPROVAL',
      },
      select: { id: true },
    });

    // An ADMIN holds ai:approve:any but is not a super administrator.
    const denied = await approveAction({ actor: adminActor(), actionId: critical.id });
    expect(denied.result).toBe('SUPER_ADMIN_REQUIRED');

    // Still held — nothing executed.
    expect(
      (await prisma.aiAction.findUniqueOrThrow({
        where: { id: critical.id },
        select: { status: true },
      })).status,
    ).toBe('PENDING_APPROVAL');

    // A super administrator may proceed.
    const superAdmin: Actor = {
      userId: superAdminUserId,
      roles: ['SUPER_ADMIN'],
      mfaSatisfied: true,
      accountActive: true,
    };
    const allowed = await approveAction({ actor: superAdmin, actionId: critical.id });
    expect(allowed.result).toBe('EXECUTED');
  });

  it('rejects an action so it can never execute', async () => {
    const actionId = await heldAction();
    const before = await prisma.assignment.count({ where: { projectId } });

    const outcome = await rejectAction({
      actor: adminActor(),
      actionId,
      reason: 'Wrong expert for this brief',
    });

    expect(outcome.result).toBe('REJECTED');
    expect(await prisma.assignment.count({ where: { projectId } })).toBe(before);

    // And approval afterwards is refused.
    expect((await approveAction({ actor: adminActor(), actionId })).result).toBe('NOT_PENDING');
  });
});

describe.skipIf(!databaseAvailable)('failure handling and retry', () => {
  it('retries a transient provider failure and then succeeds', async () => {
    fake.pushError(new ProviderError('rate limited', { code: 'ANTHROPIC_429', retryable: true }));
    fake.pushOutput({
      findings: [],
      flagCount: 0,
      recommendationForReviewer: 'LOOKS_CONSISTENT',
      confidence: 'HIGH',
    });

    const result = await runAgent({
      agentKey: 'VERIFICATION',
      input: { expertId },
      actor: adminActor(),
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(fake.callCount).toBe(2);
  });

  it('does not retry a non-retryable failure', async () => {
    fake.pushError(
      new ProviderError('bad request', { code: 'ANTHROPIC_400', retryable: false }),
    );

    const result = await runAgent({
      agentKey: 'VERIFICATION',
      input: { expertId },
      actor: adminActor(),
    });

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('ANTHROPIC_400');
    expect(fake.callCount).toBe(1);
  });

  it('records a terminal failure instead of throwing at the caller', async () => {
    fake.pushError(new ProviderError('refused', { code: 'PROVIDER_REFUSAL', retryable: false }));

    const result = await runAgent({
      agentKey: 'VERIFICATION',
      input: { expertId },
      actor: adminActor(),
    });

    const run = await prisma.aiRun.findUniqueOrThrow({
      where: { id: result.runId },
      select: { status: true, errorCode: true, completedAt: true },
    });
    expect(run.status).toBe('FAILED');
    expect(run.errorCode).toBe('PROVIDER_REFUSAL');
    expect(run.completedAt).not.toBeNull();
  });
});

describe.skipIf(!databaseAvailable)('observability', () => {
  it('reports health metrics without exposing floats', async () => {
    const metrics = await getHealthMetrics({ actor: adminActor() });

    expect(metrics.totalRuns).toBeGreaterThan(0);
    expect(Number.isInteger(metrics.successRateBasisPoints)).toBe(true);
    expect(metrics.successRateBasisPoints).toBeLessThanOrEqual(10_000);
    expect(typeof metrics.totalCostMinor).toBe('string');
  });

  it('denies observability to a caller without ai:read:any', async () => {
    const customer: Actor = {
      userId: customerUserId,
      roles: ['CUSTOMER'],
      mfaSatisfied: true,
      accountActive: true,
    };
    await expect(getHealthMetrics({ actor: customer })).rejects.toThrow(/Authorization denied/);
  });
});

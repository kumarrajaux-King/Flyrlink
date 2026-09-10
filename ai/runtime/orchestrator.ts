/**
 * The central AI orchestrator.
 *
 * One entry point — `runAgent` — drives the whole controlled path:
 *
 *   resolve agent + version   (traceability)
 *     → redact input          (privacy, before egress AND before persistence)
 *     → persist AiRun         (durable record, starts RUNNING)
 *     → call provider         (with retry on transient failures)
 *     → for each tool call:
 *          policy.evaluate    (permission, allow-list, risk tier)
 *          persist AiAction   (every proposal recorded, executed or not)
 *          execute OR hold for human approval
 *     → validate output       (Zod; invalid output never reaches the database)
 *     → persist usage + cost + latency
 *     → audit
 *
 * Design rules that matter:
 *
 *   - **Nothing is written on an invalid output.** A schema failure marks the run
 *     VALIDATION_FAILED and stops. Partial writes from half-understood output are
 *     how agentic systems corrupt data.
 *   - **Every proposed tool call is persisted**, including denied ones, so the
 *     audit trail shows what the agent *wanted* to do, not only what it did.
 *   - **HIGH/CRITICAL calls never execute inline.** They are recorded as
 *     PENDING_APPROVAL and the run ends. A human resumes them through the
 *     approval service.
 *   - **The run never throws into the caller for an agent-level failure.** It
 *     returns a terminal status, because a failed agent must not break the
 *     product flow that invoked it.
 */

import { z } from 'zod';

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import { type AgentDefinition, type AgentKey, getAgentDefinition } from '../agents/definitions';
import { evaluate, statusForDecision, type PolicyDecision } from '../policy/policy-engine';
import { getProvider, ProviderError, type AiCompletionResponse, type ProviderToolSpec } from '../providers';
import { redactForStorage, redactPii } from '../redaction/redact';
import { executeTool, getTool, toolDescriptor } from '../tools';
import { resolveAgentRecords } from './agent-sync';

/** Hard ceiling on provider round-trips, so a tool loop cannot run away. */
const MAX_TOOL_ITERATIONS = 6;
/** Transient failures are retried this many times beyond the first attempt. */
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 250;
const DEFAULT_TIMEOUT_MS = 120_000;

export type RunStatus =
  | 'SUCCEEDED'
  | 'VALIDATION_FAILED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'CANCELLED';

export interface PendingApproval {
  readonly actionId: string;
  readonly toolName: string;
  readonly riskTier: string;
  readonly requiresSuperAdmin: boolean;
  readonly reason: string;
}

export interface AgentRunResult {
  readonly runId: string;
  readonly status: RunStatus;
  readonly output: unknown;
  /** Actions recorded but withheld pending a human decision. */
  readonly pendingApprovals: readonly PendingApproval[];
  readonly errorCode?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly costMinor: bigint;
  readonly currency: string;
}

export interface RunAgentParams<TInput = unknown> {
  readonly agentKey: AgentKey;
  readonly input: TInput;
  /** The human this run acts for. All tool permissions are checked against them. */
  readonly actor: Actor;
  readonly projectId?: string | undefined;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly trigger?: 'USER_REQUEST' | 'SYSTEM_EVENT' | 'SCHEDULED' | 'ADMIN_REQUEST' | 'RETRY';
  readonly requestContext?: RequestContext | undefined;
  readonly db?: Db | undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Convert an agent's Zod schema into the JSON Schema both providers accept. */
function toJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
}

/** Build the tool specs a given agent is allowed to offer the model. */
function buildToolSpecs(definition: AgentDefinition): ProviderToolSpec[] {
  const specs: ProviderToolSpec[] = [];
  for (const name of definition.allowedTools) {
    const tool = getTool(name);
    // A definition referencing an unregistered tool is a configuration bug, but
    // it must not abort the run — the agent simply cannot use it.
    if (!tool) continue;
    specs.push({
      name: tool.name,
      description: tool.description,
      inputSchema: toJsonSchema(tool.inputSchema as z.ZodType<unknown>),
    });
  }
  return specs;
}

export async function runAgent<TInput = unknown>(
  params: RunAgentParams<TInput>,
): Promise<AgentRunResult> {
  const db = params.db ?? prisma;
  const definition = getAgentDefinition(params.agentKey);
  const startedAt = Date.now();

  const records = await resolveAgentRecords(db, definition);

  // Redacted on the way in: this is what we persist AND what we send.
  const redactedInput = redactForStorage(params.input);

  const run = await db.aiRun.create({
    data: {
      agentId: records.agentId,
      agentVersionId: records.agentVersionId,
      model: definition.model,
      provider: definition.provider,
      projectId: params.projectId ?? null,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      trigger: params.trigger ?? 'USER_REQUEST',
      triggeredByUserId: params.actor.userId,
      status: 'RUNNING',
      inputPayload: redactedInput,
      startedAt: new Date(),
    },
    select: { id: true },
  });

  const pendingApprovals: PendingApproval[] = [];
  let costMinor = 0n;
  let currency = 'USD';

  try {
    if (!records.isEnabled) {
      return await finish(db, run.id, {
        status: 'CANCELLED',
        errorCode: 'AGENT_DISABLED',
        errorMessage: `Agent ${definition.key} is disabled.`,
        startedAt,
        costMinor,
        currency,
        pendingApprovals,
      });
    }

    // Validate our own input before spending a token on it.
    const parsedInput = definition.inputSchema.safeParse(params.input);
    if (!parsedInput.success) {
      return await finish(db, run.id, {
        status: 'VALIDATION_FAILED',
        errorCode: 'AGENT_INPUT_INVALID',
        errorMessage: 'Agent input did not match its schema.',
        validationErrors: parsedInput.error.issues,
        startedAt,
        costMinor,
        currency,
        pendingApprovals,
      });
    }

    const provider = getProvider(definition.provider);
    const outputJsonSchema = toJsonSchema(definition.outputSchema as z.ZodType<unknown>);
    const toolSpecs = buildToolSpecs(definition);

    // The running conversation input. Tool results are appended so the model can
    // build on what it retrieved.
    let conversationInput: unknown = redactPii(parsedInput.data);
    let response: AiCompletionResponse | null = null;
    let approvalHeld = false;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      response = await callWithRetry(provider, {
        system: definition.systemPrompt,
        input: conversationInput,
        outputSchema: outputJsonSchema,
        model: definition.model,
        maxTokens: definition.maxTokens,
        effort: definition.effort,
        tools: toolSpecs.length > 0 ? toolSpecs : undefined,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });

      const cost = provider.estimateCostMinor(response.model, response.usage);
      costMinor += cost.amountMinor;
      currency = cost.currency;

      if (response.toolCalls.length === 0) break;

      const toolResults: unknown[] = [];

      for (const call of response.toolCalls) {
        const decision = evaluate(call.name, {
          actor: params.actor,
          agentAllowedTools: definition.allowedTools,
          agentEnabled: records.isEnabled,
          lookupTool: toolDescriptor,
        });

        const action = await recordAction(db, {
          aiRunId: run.id,
          call,
          decision,
        });

        if (decision.effect === 'DENY') {
          toolResults.push({
            tool: call.name,
            error: `Denied by policy: ${decision.reason}`,
          });
          continue;
        }

        if (decision.effect === 'REQUIRE_APPROVAL') {
          approvalHeld = true;
          pendingApprovals.push({
            actionId: action.id,
            toolName: call.name,
            riskTier: action.riskTier,
            requiresSuperAdmin: decision.requiresSuperAdmin,
            reason: decision.reason,
          });
          toolResults.push({
            tool: call.name,
            status: 'awaiting_human_approval',
          });
          continue;
        }

        // ALLOW — execute now, and record the outcome on the action.
        try {
          const result = await executeTool(call.name, call.input, {
            actor: params.actor,
            db,
            aiRunId: run.id,
            requestContext: params.requestContext,
          });

          await db.aiAction.update({
            where: { id: action.id },
            data: {
              status: 'EXECUTED',
              executedAt: new Date(),
              resultPayload: redactForStorage(result),
            },
          });

          toolResults.push({ tool: call.name, result });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Tool execution failed.';
          await db.aiAction.update({
            where: { id: action.id },
            data: { status: 'FAILED', errorCode: 'TOOL_FAILED', errorMessage: message },
          });
          // Feed the failure back rather than aborting: the model can often
          // recover by trying a different approach.
          toolResults.push({ tool: call.name, error: message });
        }
      }

      // A held approval means the agent cannot finish this turn. End the run and
      // let the human decide; resuming is an explicit, separate act.
      if (approvalHeld) break;

      conversationInput = {
        original: redactPii(parsedInput.data),
        toolResults: redactPii(toolResults),
      };
    }

    if (!response) {
      return await finish(db, run.id, {
        status: 'FAILED',
        errorCode: 'NO_RESPONSE',
        errorMessage: 'The provider returned no response.',
        startedAt,
        costMinor,
        currency,
        pendingApprovals,
      });
    }

    if (approvalHeld) {
      // Not a failure: the agent did its job and stopped at the approval gate.
      return await finish(db, run.id, {
        status: 'SUCCEEDED',
        output: null,
        usage: response.usage,
        startedAt,
        costMinor,
        currency,
        pendingApprovals,
      });
    }

    const parsedOutput = definition.outputSchema.safeParse(response.output);
    if (!parsedOutput.success) {
      return await finish(db, run.id, {
        status: 'VALIDATION_FAILED',
        errorCode: 'AGENT_OUTPUT_INVALID',
        errorMessage: 'Agent output did not match its schema.',
        validationErrors: parsedOutput.error.issues,
        usage: response.usage,
        startedAt,
        costMinor,
        currency,
        pendingApprovals,
      });
    }

    return await finish(db, run.id, {
      status: 'SUCCEEDED',
      output: parsedOutput.data,
      usage: response.usage,
      startedAt,
      costMinor,
      currency,
      pendingApprovals,
    });
  } catch (error) {
    const isProviderError = error instanceof ProviderError;
    return await finish(db, run.id, {
      status: isProviderError && error.code === 'PROVIDER_TIMEOUT' ? 'TIMED_OUT' : 'FAILED',
      errorCode: isProviderError ? error.code : 'ORCHESTRATOR_ERROR',
      errorMessage: error instanceof Error ? error.message : 'Unknown orchestrator failure.',
      startedAt,
      costMinor,
      currency,
      pendingApprovals,
    });
  }
}

/** Retry transient provider failures with exponential backoff. */
async function callWithRetry(
  provider: ReturnType<typeof getProvider>,
  request: Parameters<ReturnType<typeof getProvider>['complete']>[0],
): Promise<AiCompletionResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await provider.complete(request);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt === MAX_RETRIES) break;
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw lastError;
}

/** Persist a proposed tool call and the policy decision that gated it. */
async function recordAction(
  db: Db,
  params: {
    aiRunId: string;
    call: { id: string; name: string; input: unknown };
    decision: PolicyDecision;
  },
): Promise<{ id: string; riskTier: string }> {
  const descriptor = toolDescriptor(params.call.name);
  const riskTier = descriptor?.riskTier ?? 'CRITICAL';
  const status = statusForDecision(params.decision);

  const action = await db.aiAction.create({
    data: {
      aiRunId: params.aiRunId,
      toolName: params.call.name,
      // An unknown tool is treated as CRITICAL rather than defaulting low.
      riskTier,
      requestedPayload: redactForStorage(params.call.input),
      status,
      policyDecision: params.decision.effect,
      policyReason: params.decision.reason,
      requiresHumanApproval: params.decision.effect === 'REQUIRE_APPROVAL',
      ...(params.decision.effect === 'DENY' ? { rejectedReason: params.decision.reason } : {}),
      // Ties a retry of the same call to the same row.
      idempotencyKey: params.call.id,
    },
    select: { id: true, riskTier: true },
  });

  return { id: action.id, riskTier: action.riskTier };
}

interface FinishParams {
  status: RunStatus;
  output?: unknown;
  errorCode?: string;
  errorMessage?: string;
  validationErrors?: unknown;
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
  startedAt: number;
  costMinor: bigint;
  currency: string;
  pendingApprovals: PendingApproval[];
}

/** Write the terminal run record and return the result. */
async function finish(db: Db, runId: string, params: FinishParams): Promise<AgentRunResult> {
  const latencyMs = Date.now() - params.startedAt;

  await db.aiRun.update({
    where: { id: runId },
    data: {
      status: params.status,
      ...(params.output !== undefined && params.output !== null
        ? { outputPayload: redactForStorage(params.output) }
        : {}),
      validationStatus:
        params.status === 'VALIDATION_FAILED'
          ? 'FAILED'
          : params.status === 'SUCCEEDED'
            ? 'PASSED'
            : 'NOT_APPLICABLE',
      ...(params.validationErrors
        ? { validationErrors: redactForStorage(params.validationErrors) }
        : {}),
      latencyMs,
      inputTokens: params.usage?.inputTokens ?? null,
      outputTokens: params.usage?.outputTokens ?? null,
      cachedInputTokens: params.usage?.cachedInputTokens ?? null,
      costMinor: params.costMinor,
      currency: params.currency,
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ?? null,
      completedAt: new Date(),
    },
  });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.AI_RUN_COMPLETED,
    entityType: 'AiRun',
    entityId: runId,
    actorType: 'AI_AGENT',
    actorAiRunId: runId,
    severity: params.status === 'SUCCEEDED' ? 'INFO' : 'WARNING',
    afterState: {
      status: params.status,
      latencyMs,
      costMinor: params.costMinor.toString(),
      currency: params.currency,
      pendingApprovals: params.pendingApprovals.length,
    },
  });

  return {
    runId,
    status: params.status,
    output: params.output ?? null,
    pendingApprovals: params.pendingApprovals,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    costMinor: params.costMinor,
    currency: params.currency,
  };
}

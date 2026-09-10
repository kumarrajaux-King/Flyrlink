/**
 * Deterministic in-memory provider for tests.
 *
 * Phase 7 requires tests that exercise the whole agentic path — orchestration,
 * validation, policy, tool execution, persistence — with **no live AI
 * dependency**. This adapter makes that possible: responses are scripted, so
 * every assertion is exact and every run is reproducible.
 *
 * It also records the requests it received, which is how tests verify the things
 * that matter most and are otherwise invisible: that redaction happened before
 * egress, that untrusted content never reached the system prompt, and that only
 * an agent's allow-listed tools were offered to the model.
 */

import {
  type AiCompletionRequest,
  type AiCompletionResponse,
  type AiProvider,
  type AiUsage,
  type ProviderToolCall,
  ProviderError,
} from './provider';

const ZERO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

/** One scripted turn: return output, request tools, or fail. */
export type FakeScriptStep =
  | { readonly kind: 'output'; readonly output: unknown; readonly usage?: Partial<AiUsage> }
  | { readonly kind: 'toolCalls'; readonly toolCalls: readonly ProviderToolCall[]; readonly usage?: Partial<AiUsage> }
  | { readonly kind: 'error'; readonly error: ProviderError };

export class FakeProvider implements AiProvider {
  readonly name = 'fake' as const;

  private readonly script: FakeScriptStep[] = [];
  /** Every request this provider received, in order. */
  readonly requests: AiCompletionRequest[] = [];

  /** Queue a successful structured response. */
  pushOutput(output: unknown, usage?: Partial<AiUsage>): this {
    this.script.push(usage ? { kind: 'output', output, usage } : { kind: 'output', output });
    return this;
  }

  /** Queue a turn in which the model asks to call tools. */
  pushToolCalls(toolCalls: readonly ProviderToolCall[], usage?: Partial<AiUsage>): this {
    this.script.push(usage ? { kind: 'toolCalls', toolCalls, usage } : { kind: 'toolCalls', toolCalls });
    return this;
  }

  /** Queue a failure — used to test retry and terminal-failure handling. */
  pushError(error: ProviderError): this {
    this.script.push({ kind: 'error', error });
    return this;
  }

  reset(): void {
    this.script.length = 0;
    this.requests.length = 0;
  }

  get callCount(): number {
    return this.requests.length;
  }

  lastRequest(): AiCompletionRequest | undefined {
    return this.requests.at(-1);
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    this.requests.push(request);

    const step = this.script.shift();
    if (!step) {
      throw new ProviderError(
        'FakeProvider script is empty — queue a response with pushOutput/pushToolCalls.',
        { code: 'FAKE_SCRIPT_EXHAUSTED', retryable: false },
      );
    }

    if (step.kind === 'error') throw step.error;

    const usage: AiUsage = { ...ZERO_USAGE, ...(step.usage ?? {}) };

    return step.kind === 'output'
      ? {
          output: step.output,
          toolCalls: [],
          usage,
          model: request.model,
          provider: this.name,
          stopReason: 'end_turn',
        }
      : {
          output: null,
          toolCalls: step.toolCalls,
          usage,
          model: request.model,
          provider: this.name,
          stopReason: 'tool_use',
        };
  }

  /** Flat, predictable pricing so cost assertions are exact. */
  estimateCostMinor(_model: string, usage: AiUsage): { amountMinor: bigint; currency: string } {
    const amountMinor = BigInt(usage.inputTokens + usage.outputTokens);
    return { amountMinor, currency: 'USD' };
  }
}

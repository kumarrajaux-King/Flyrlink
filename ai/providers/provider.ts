/**
 * AI provider abstraction.
 *
 * STEP 02 §25 requires every external provider to sit behind an adapter, so no
 * business logic imports a vendor SDK. Agents describe *what* they need; an
 * adapter decides how to ask a specific vendor for it.
 *
 * The interface is deliberately narrow: one structured completion call. Agents
 * do not stream to end users, do not hold provider-side conversation state, and
 * do not call vendor-specific features. That keeps a second provider a
 * drop-in, and keeps the orchestrator testable against a fake.
 */

export type ProviderName = 'anthropic' | 'openai' | 'fake';

/** A tool the model may request, described in a vendor-neutral way. */
export interface ProviderToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema derived from the tool's Zod input schema. */
  readonly inputSchema: Record<string, unknown>;
}

export interface AiCompletionRequest {
  /** Stable system instruction for the agent. Never contains user data. */
  readonly system: string;
  /**
   * The task payload. Untrusted user content lives HERE, never in `system`,
   * so a prompt-injection attempt cannot rewrite the agent's instructions.
   */
  readonly input: unknown;
  /** JSON Schema the response must satisfy. */
  readonly outputSchema: Record<string, unknown>;
  readonly model: string;
  readonly maxTokens: number;
  /** Depth/cost dial. Mapped per provider. */
  readonly effort?: 'low' | 'medium' | 'high' | undefined;
  readonly tools?: readonly ProviderToolSpec[] | undefined;
  readonly timeoutMs?: number | undefined;
}

/** A tool call the model asked for. Executing it is the orchestrator's job. */
export interface ProviderToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
}

export interface AiCompletionResponse {
  /** Parsed JSON matching `outputSchema`. Null when the model only called tools. */
  readonly output: unknown;
  readonly toolCalls: readonly ProviderToolCall[];
  readonly usage: AiUsage;
  readonly model: string;
  readonly provider: ProviderName;
  readonly stopReason: string;
}

export interface AiProvider {
  readonly name: ProviderName;
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
  /**
   * Cost of a usage record, in minor units of `currency`.
   * Returned as bigint so it lands in `AiRun.costMinor` without float error
   * (T-03 applies to AI spend exactly as it does to customer money).
   */
  estimateCostMinor(model: string, usage: AiUsage): { amountMinor: bigint; currency: string };
}

/** Retryable = transient. Non-retryable = a bad request that will fail again. */
export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly code: string;

  constructor(message: string, options: { code: string; retryable: boolean; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ProviderError';
    this.code = options.code;
    this.retryable = options.retryable;
  }
}

/** Model output that did not parse as JSON. Retryable once — models sometimes recover. */
export class ProviderOutputError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'PROVIDER_OUTPUT_UNPARSEABLE', retryable: true, cause });
    this.name = 'ProviderOutputError';
  }
}

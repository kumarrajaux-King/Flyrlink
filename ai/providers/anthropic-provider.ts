/**
 * Anthropic provider adapter.
 *
 * Default provider (T-06). Uses structured outputs so the model returns JSON
 * matching the agent's schema, and adaptive thinking so reasoning depth is the
 * model's decision rather than a fixed token budget.
 *
 * Nothing outside this file imports the Anthropic SDK.
 */

import Anthropic from '@anthropic-ai/sdk';

import {
  type AiCompletionRequest,
  type AiCompletionResponse,
  type AiProvider,
  type AiUsage,
  type ProviderToolCall,
  ProviderError,
  ProviderOutputError,
} from './provider';

/** Default model for reasoning-heavy agents. */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5';

/**
 * Price per 1,000,000 tokens, in USD **cents** (minor units, T-03).
 * Held as bigint so cost arithmetic never touches a float.
 */
const PRICING_CENTS_PER_MTOK: Readonly<Record<string, { input: bigint; output: bigint; cachedInput: bigint }>> = {
  'claude-opus-5': { input: 500n, output: 2500n, cachedInput: 50n },
  'claude-sonnet-5': { input: 200n, output: 1000n, cachedInput: 20n },
  'claude-haiku-4-5': { input: 100n, output: 500n, cachedInput: 10n },
};

const FALLBACK_PRICING = PRICING_CENTS_PER_MTOK['claude-opus-5']!;
const TOKENS_PER_MILLION = 1_000_000n;

export interface AnthropicProviderOptions {
  apiKey?: string | undefined;
  /** Injectable for tests; defaults to a real client. */
  client?: Anthropic | undefined;
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!options.client && !apiKey) {
      throw new ProviderError('ANTHROPIC_API_KEY is not set.', {
        code: 'PROVIDER_NOT_CONFIGURED',
        retryable: false,
      });
    }
    this.client = options.client ?? new Anthropic({ apiKey });
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    let message: Anthropic.Message;

    try {
      message = await this.client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          // The agent's instructions. Never contains user data, so untrusted
          // content in `input` cannot rewrite them.
          system: request.system,
          messages: [{ role: 'user', content: JSON.stringify(request.input) }],
          output_config: {
            format: { type: 'json_schema', schema: request.outputSchema },
            ...(request.effort ? { effort: request.effort } : {}),
          },
          thinking: { type: 'adaptive' },
          ...(request.tools && request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
                  // Guarantees tool arguments validate against the schema.
                  strict: true,
                })),
              }
            : {}),
        },
        request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : undefined,
      );
    } catch (error) {
      throw toProviderError(error);
    }

    // Safety classifiers can decline with HTTP 200. Check before reading content.
    if (message.stop_reason === 'refusal') {
      throw new ProviderError('The model declined this request.', {
        code: 'PROVIDER_REFUSAL',
        retryable: false,
      });
    }

    const toolCalls: ProviderToolCall[] = [];
    const textParts: string[] = [];

    for (const block of message.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
      }
    }

    const usage: AiUsage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cachedInputTokens: message.usage.cache_read_input_tokens ?? 0,
    };

    // When the model called tools it has not produced its final answer yet, so
    // an absent output is expected rather than an error.
    const raw = textParts.join('').trim();
    const output = raw.length > 0 ? parseJson(raw) : null;

    return {
      output,
      toolCalls,
      usage,
      model: message.model,
      provider: this.name,
      stopReason: message.stop_reason ?? 'unknown',
    };
  }

  estimateCostMinor(model: string, usage: AiUsage): { amountMinor: bigint; currency: string } {
    const pricing = PRICING_CENTS_PER_MTOK[model] ?? FALLBACK_PRICING;

    // Cached input is billed at the cheaper rate, so bill it separately rather
    // than charging every input token at full price.
    const freshInput = BigInt(Math.max(0, usage.inputTokens - usage.cachedInputTokens));
    const cachedInput = BigInt(usage.cachedInputTokens);
    const output = BigInt(usage.outputTokens);

    const total =
      freshInput * pricing.input + cachedInput * pricing.cachedInput + output * pricing.output;

    // Round up: never under-report spend.
    const amountMinor = (total + TOKENS_PER_MILLION - 1n) / TOKENS_PER_MILLION;
    return { amountMinor, currency: 'USD' };
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ProviderOutputError('Model output was not valid JSON.', error);
  }
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    // 408/409/429 and 5xx are transient; 4xx otherwise means the request is wrong.
    const retryable = status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
    return new ProviderError(`Anthropic API error (${status}).`, {
      code: `ANTHROPIC_${status || 'CONNECTION'}`,
      retryable,
      cause: error,
    });
  }

  return new ProviderError('Anthropic request failed.', {
    code: 'ANTHROPIC_UNKNOWN',
    retryable: true,
    cause: error,
  });
}

/**
 * OpenAI provider adapter.
 *
 * Present so the abstraction is demonstrably real rather than aspirational: the
 * orchestrator can switch providers without any agent, tool or policy change.
 * Anthropic remains the default (T-06).
 *
 * Nothing outside this file imports the OpenAI SDK.
 */

import OpenAI from 'openai';

import {
  type AiCompletionRequest,
  type AiCompletionResponse,
  type AiProvider,
  type AiUsage,
  type ProviderToolCall,
  ProviderError,
  ProviderOutputError,
} from './provider';

export const OPENAI_DEFAULT_MODEL = 'gpt-5';

/** Price per 1,000,000 tokens in USD cents. Update alongside vendor pricing. */
const PRICING_CENTS_PER_MTOK: Readonly<Record<string, { input: bigint; output: bigint; cachedInput: bigint }>> = {
  'gpt-5': { input: 125n, output: 1000n, cachedInput: 13n },
  'gpt-5-mini': { input: 25n, output: 200n, cachedInput: 3n },
};

const FALLBACK_PRICING = PRICING_CENTS_PER_MTOK['gpt-5']!;
const TOKENS_PER_MILLION = 1_000_000n;

export interface OpenAiProviderOptions {
  apiKey?: string | undefined;
  client?: OpenAI | undefined;
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const;
  private readonly client: OpenAI;

  constructor(options: OpenAiProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!options.client && !apiKey) {
      throw new ProviderError('OPENAI_API_KEY is not set.', {
        code: 'PROVIDER_NOT_CONFIGURED',
        retryable: false,
      });
    }
    this.client = options.client ?? new OpenAI({ apiKey });
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    let completion: OpenAI.Chat.Completions.ChatCompletion;

    try {
      completion = await this.client.chat.completions.create(
        {
          model: request.model,
          max_completion_tokens: request.maxTokens,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: JSON.stringify(request.input) },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'agent_output',
              strict: true,
              schema: request.outputSchema,
            },
          },
          ...(request.tools && request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  type: 'function' as const,
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                    strict: true,
                  },
                })),
              }
            : {}),
        },
        request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : undefined,
      );
    } catch (error) {
      throw toProviderError(error);
    }

    const choice = completion.choices[0];
    if (!choice) {
      throw new ProviderError('OpenAI returned no choices.', {
        code: 'OPENAI_EMPTY_RESPONSE',
        retryable: true,
      });
    }

    if (choice.message.refusal) {
      throw new ProviderError('The model declined this request.', {
        code: 'PROVIDER_REFUSAL',
        retryable: false,
      });
    }

    const toolCalls: ProviderToolCall[] = (choice.message.tool_calls ?? []).flatMap((call) =>
      call.type === 'function'
        ? [{ id: call.id, name: call.function.name, input: parseJson(call.function.arguments) }]
        : [],
    );

    const usage: AiUsage = {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      cachedInputTokens: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    };

    const raw = choice.message.content?.trim() ?? '';
    const output = raw.length > 0 ? parseJson(raw) : null;

    return {
      output,
      toolCalls,
      usage,
      model: completion.model,
      provider: this.name,
      stopReason: choice.finish_reason,
    };
  }

  estimateCostMinor(model: string, usage: AiUsage): { amountMinor: bigint; currency: string } {
    const pricing = PRICING_CENTS_PER_MTOK[model] ?? FALLBACK_PRICING;

    const freshInput = BigInt(Math.max(0, usage.inputTokens - usage.cachedInputTokens));
    const cachedInput = BigInt(usage.cachedInputTokens);
    const output = BigInt(usage.outputTokens);

    const total =
      freshInput * pricing.input + cachedInput * pricing.cachedInput + output * pricing.output;

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

  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    const retryable = status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
    return new ProviderError(`OpenAI API error (${status}).`, {
      code: `OPENAI_${status || 'CONNECTION'}`,
      retryable,
      cause: error,
    });
  }

  return new ProviderError('OpenAI request failed.', {
    code: 'OPENAI_UNKNOWN',
    retryable: true,
    cause: error,
  });
}

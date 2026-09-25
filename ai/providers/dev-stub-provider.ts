/**
 * The provider used in development when no vendor key is configured.
 *
 * WHY IT EXISTS
 *   Without it, every agent flow is unreachable on a laptop: `AnthropicProvider`
 *   throws on a missing key, and `FakeProvider` only replays a script a test
 *   queued, so a real request gets `FAKE_SCRIPT_EXHAUSTED`. That leaves the
 *   whole intake experience untestable by anyone who has not bought an API key,
 *   which is the wrong default for a contributor cloning the repository.
 *
 * WHAT IT DOES
 *   Every request carries the JSON Schema its output must satisfy, so this
 *   provider *derives* a minimal valid instance from that schema rather than
 *   holding canned answers per agent. It works for all thirteen agents, and it
 *   keeps working when an agent's output shape changes.
 *
 * WHAT IT IS NOT
 *   It is not a model. The text it produces is assembled from the brief and
 *   labelled as a stub, because a plausible-looking fabrication presented as
 *   analysis is worse than an obvious placeholder. The registry refuses to
 *   select it in production, where a missing key stays a loud failure.
 *
 *   It never asks for a tool call. An agent run against it therefore records a
 *   run and its output, and changes nothing else.
 */

import {
  type AiCompletionRequest,
  type AiCompletionResponse,
  type AiProvider,
  ProviderError,
} from './provider';

/** Marks every free-text field this provider invents, wherever it surfaces. */
export const DEV_STUB_NOTICE = '[dev stub — no AI provider configured]';

type Schema = Record<string, unknown>;

function asSchema(value: unknown): Schema | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Schema) : null;
}

/** The first string in the request input, used so output reflects the brief. */
function briefFrom(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';

  const preferred = ['description', 'brief', 'summary', 'title', 'content'];
  const record = input as Record<string, unknown>;
  for (const key of preferred) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

function clamp(text: string, schema: Schema): string {
  const max = typeof schema.maxLength === 'number' ? schema.maxLength : undefined;
  const min = typeof schema.minLength === 'number' ? schema.minLength : 0;
  let out = text;
  if (out.length < min) out = out.padEnd(min, '.');
  if (max !== undefined && out.length > max) out = out.slice(0, max);
  return out;
}

/**
 * Build one value satisfying `schema`.
 *
 * Deliberately minimal: required properties only, arrays at their minimum
 * length, enums at their first member. A stub that filled every optional field
 * would read as a confident answer.
 */
function sample(schema: Schema, brief: string, depth = 0): unknown {
  if (depth > 8) return null;

  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;

  // Unions: take the first branch that is itself a schema.
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const branches = schema[key];
    if (Array.isArray(branches)) {
      const first = branches.map(asSchema).find((branch): branch is Schema => branch !== null);
      if (first) return sample(first, brief, depth + 1);
    }
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case 'object': {
      const properties = asSchema(schema.properties) ?? {};
      const required = Array.isArray(schema.required) ? (schema.required as string[]) : Object.keys(properties);
      const out: Record<string, unknown> = {};
      for (const name of required) {
        const child = asSchema(properties[name]);
        out[name] = child ? sample(child, brief, depth + 1) : null;
      }
      return out;
    }

    case 'array': {
      const items = asSchema(schema.items);
      const min = typeof schema.minItems === 'number' ? Math.max(1, schema.minItems) : 1;
      const max = typeof schema.maxItems === 'number' ? schema.maxItems : min;
      const count = Math.min(min, max);
      if (!items) return [];
      return Array.from({ length: count }, () => sample(items, brief, depth + 1));
    }

    case 'integer':
    case 'number': {
      const min = typeof schema.minimum === 'number' ? schema.minimum : 1;
      const max = typeof schema.maximum === 'number' ? schema.maximum : min + 1;
      const value = Math.min(Math.max(min, 1), max);
      return type === 'integer' ? Math.round(value) : value;
    }

    case 'boolean':
      // False is the safer default: every boolean in these schemas reads as
      // "ready", "approved" or "confident", and a stub should claim none of them.
      return false;

    case 'null':
      return null;

    default: {
      const text = brief ? `${DEV_STUB_NOTICE} ${brief}` : DEV_STUB_NOTICE;
      return clamp(text, schema);
    }
  }
}

export class DevStubProvider implements AiProvider {
  readonly name = 'fake' as const;

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    if (process.env.NODE_ENV === 'production') {
      throw new ProviderError('The development stub provider must never run in production.', {
        code: 'PROVIDER_NOT_CONFIGURED',
        retryable: false,
      });
    }

    const output = sample(request.outputSchema, briefFrom(request.input));

    return {
      output,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      model: request.model,
      provider: this.name,
      stopReason: 'stub',
    };
  }

  /** A stub costs nothing, and says so rather than inventing a figure. */
  estimateCostMinor(): { amountMinor: bigint; currency: string } {
    return { amountMinor: 0n, currency: 'USD' };
  }
}

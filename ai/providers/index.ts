/**
 * Provider registry.
 *
 * Resolves a provider by name and caches the instance. The orchestrator asks for
 * a provider here; it never constructs a vendor client itself.
 */

import { AnthropicProvider } from './anthropic-provider';
import { FakeProvider } from './fake-provider';
import { OpenAiProvider } from './openai-provider';
import { type AiProvider, type ProviderName, ProviderError } from './provider';

export * from './provider';
export { AnthropicProvider, ANTHROPIC_DEFAULT_MODEL } from './anthropic-provider';
export { OpenAiProvider, OPENAI_DEFAULT_MODEL } from './openai-provider';
export { FakeProvider } from './fake-provider';

const cache = new Map<ProviderName, AiProvider>();

/**
 * Test override. When set, every resolution returns this provider regardless of
 * what an agent version requests — so a test can exercise real agent config
 * without reaching the network.
 */
let override: AiProvider | null = null;

export function setProviderOverride(provider: AiProvider | null): void {
  override = provider;
}

export function getProvider(name: ProviderName): AiProvider {
  if (override) return override;

  const cached = cache.get(name);
  if (cached) return cached;

  const created = create(name);
  cache.set(name, created);
  return created;
}

function create(name: ProviderName): AiProvider {
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'openai':
      return new OpenAiProvider();
    case 'fake':
      return new FakeProvider();
    default:
      throw new ProviderError(`Unknown AI provider: ${String(name)}`, {
        code: 'PROVIDER_UNKNOWN',
        retryable: false,
      });
  }
}

/** Drop cached clients. Used between tests. */
export function resetProviderCache(): void {
  cache.clear();
  override = null;
}

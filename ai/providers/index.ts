/**
 * Provider registry.
 *
 * Resolves a provider by name and caches the instance. The orchestrator asks for
 * a provider here; it never constructs a vendor client itself.
 */

import { AnthropicProvider } from './anthropic-provider';
import { DevStubProvider } from './dev-stub-provider';
import { FakeProvider } from './fake-provider';
import { OpenAiProvider } from './openai-provider';
import { type AiProvider, type ProviderName, ProviderError } from './provider';

export * from './provider';
export { AnthropicProvider, ANTHROPIC_DEFAULT_MODEL } from './anthropic-provider';
export { OpenAiProvider, OPENAI_DEFAULT_MODEL } from './openai-provider';
export { FakeProvider } from './fake-provider';
export { DevStubProvider, DEV_STUB_NOTICE } from './dev-stub-provider';

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

/** True when the named vendor has credentials in this environment. */
function isConfigured(name: ProviderName): boolean {
  switch (name) {
    case 'anthropic':
      return Boolean(process.env.ANTHROPIC_API_KEY);
    case 'openai':
      return Boolean(process.env.OPENAI_API_KEY);
    default:
      return true;
  }
}

export function getProvider(name: ProviderName): AiProvider {
  if (override) return override;

  const cached = cache.get(name);
  if (cached) return cached;

  // Development without a vendor key falls back to the deterministic fake, so
  // the agent flow is exercisable end to end on a laptop. Production never
  // does: a fabricated agent result presented as a real one is worse than a
  // visible failure, and `AnthropicProvider` throws on a missing key there.
  if (!isConfigured(name) && process.env.NODE_ENV !== 'production') {
    console.info(
      `[ai] No credentials for "${name}"; using the development stub provider. ` +
        'Its output is derived from each agent\'s output schema and labelled as a stub. ' +
        `Set ${name === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} to run real agents.`,
    );
    const stub = new DevStubProvider();
    cache.set(name, stub);
    return stub;
  }

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

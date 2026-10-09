/**
 * The `web_search` provider registry.
 *
 * A value-only list of the implemented backends, in default-preference order,
 * plus the resolution rule. No module-level mutable state: the list is constant
 * and `resolveProvider` is pure.
 */

import type { WebSearchConfig } from "./config.ts";
import type { SearchProvider } from "./provider.ts";
import { braveProvider } from "./providers/brave.ts";
import { duckDuckGoProvider } from "./providers/duckduckgo.ts";
import { searxngProvider } from "./providers/searxng.ts";
import type { SearchProviderId, SearchProviderName } from "./types.ts";

/** Every backend, in default-preference order. */
export const SEARCH_PROVIDERS: readonly SearchProvider[] = [duckDuckGoProvider, searxngProvider, braveProvider];

const PROVIDERS_BY_ID = new Map<SearchProviderId, SearchProvider>(
	SEARCH_PROVIDERS.map((provider) => [provider.id, provider]),
);

/** The provider used when nothing else is configured (keyless). */
export const DEFAULT_PROVIDER_ID: SearchProviderId = duckDuckGoProvider.id;

/** Look up a provider by id. */
export function getProvider(id: SearchProviderId): SearchProvider {
	const provider = PROVIDERS_BY_ID.get(id);
	if (!provider) throw new Error(`Unknown search provider: ${id}`);
	return provider;
}

/** The human label for a response's `provider` value. */
export function providerLabel(name: SearchProviderName): string {
	return name === "none" ? "Web" : getProvider(name).label;
}

/**
 * Resolve the one provider to use. An explicit choice is honored even when it is
 * not configured, so the failure is actionable; otherwise the first configured
 * non-default provider wins, falling back to the keyless default.
 */
export function resolveProvider(config: WebSearchConfig): SearchProvider {
	if (config.provider !== "auto") return getProvider(config.provider);
	const configured = SEARCH_PROVIDERS.find(
		(provider) => provider.id !== DEFAULT_PROVIDER_ID && provider.isConfigured(config),
	);
	return configured ?? getProvider(DEFAULT_PROVIDER_ID);
}

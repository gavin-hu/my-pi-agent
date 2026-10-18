/**
 * What `web_search` resolved to, published for `doctor`.
 *
 * The provider registry, each provider's `isConfigured`, and the `auto`
 * resolution rule all live in this extension, so this module is where the facts
 * for a diagnostic come from. It publishes a summary only — the key itself never
 * leaves the extension, just the variable name and whether a literal key exists.
 *
 * `endpoint` is deliberately null for the providers without a configurable
 * endpoint: probing an API host would report a 401 as a failure for a provider
 * that works, and there is nothing for the user to fix.
 */

import type { WebSearchProviderEvent } from "../../../lib/events.ts";
import type { WebSearchConfig } from "./config.ts";
import { DEFAULT_PROVIDER_ID, resolveProvider } from "./registry.ts";

/**
 * The facts for one session's config. `reason` distinguishes an explicit choice
 * from the auto rule, so a report can tell "you asked for this and it is not
 * configured" from "this is the keyless fallback".
 */
export function providerFacts(config: WebSearchConfig): WebSearchProviderEvent {
	const provider = resolveProvider(config);
	// `auto` only leaves the keyless default when another provider is configured,
	// so the resolved id tells the two apart.
	const reason: WebSearchProviderEvent["reason"] =
		config.provider !== "auto" ? "explicit" : provider.id === DEFAULT_PROVIDER_ID ? "default" : "configured";
	return {
		provider: provider.id,
		reason,
		configured: provider.isConfigured(config),
		// Only SearXNG's base URL is a setting a user can get wrong.
		endpoint: provider.id === "searxng" && config.endpoint !== "" ? config.endpoint : null,
		apiKeyEnv: config.apiKeyEnv || null,
		keyConfigured: config.apiKey.trim() !== "",
	};
}

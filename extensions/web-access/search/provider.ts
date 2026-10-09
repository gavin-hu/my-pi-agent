/**
 * The provider contract for `web_search`.
 *
 * One small interface every backend implements. The orchestrator (`search.ts`)
 * owns provider selection, throttling, key resolution, and error mapping, so a
 * provider only turns one request into an answer plus results. Providers are
 * pure: no module-level state.
 */

import type { HttpRunner } from "../http.ts";
import type { WebSearchConfig } from "./config.ts";
import type { SearchProviderId, SearchRequest, SearchResult } from "./types.ts";

/** Everything a provider needs for one search. */
export interface ProviderContext {
	request: SearchRequest;
	config: WebSearchConfig;
	http: HttpRunner;
	signal?: AbortSignal;
	/** Resolved API key, when the provider needs one. */
	apiKey?: string;
}

/** What a provider returns: a direct answer and/or a list of results. */
export interface ProviderResult {
	answer: string;
	results: SearchResult[];
}

/** A web-search backend. */
export interface SearchProvider {
	id: SearchProviderId;
	/** Human label used in the model-facing header. */
	label: string;
	/** Whether the current config is sufficient to call this provider. */
	isConfigured(config: WebSearchConfig): boolean;
	search(ctx: ProviderContext): Promise<ProviderResult>;
}

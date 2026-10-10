/**
 * Brave Search provider (keyed JSON API).
 *
 * `https://api.search.brave.com/res/v1/web/search` returns a general web-results
 * list. It requires an API key, sent as the `X-Subscription-Token` header and
 * resolved from `search.apiKeyEnv` (preferred) or `search.apiKey`.
 */

import { HttpUnavailableError, type HttpRunner } from "../../http.ts";
import { resolveSearchApiKey, type WebSearchConfig } from "../config.ts";
import { asRecord, asString, collectResults, requestJson } from "../json.ts";
import type { ProviderResult, SearchProvider } from "../provider.ts";
import type { SearchRequest } from "../types.ts";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_MAX_COUNT = 20;

/** Build the Brave request URL. */
export function buildBraveUrl(query: string, maxResults: number): URL {
	const url = new URL(BRAVE_ENDPOINT);
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(Math.min(BRAVE_MAX_COUNT, Math.max(1, maxResults))));
	return url;
}

/** Turn a Brave response into de-duplicated results. */
export function parseBrave(json: unknown, maxResults: number): ProviderResult {
	const web = asRecord(asRecord(json).web);
	const raw = Array.isArray(web.results) ? web.results : [];
	const results = collectResults(raw, maxResults, (record) => ({
		title: asString(record.title),
		url: asString(record.url),
		snippet: asString(record.description),
	}));
	return { answer: "", results };
}

/** Fetch and parse one Brave web search. */
export async function searchBrave(
	request: SearchRequest,
	config: WebSearchConfig,
	http: HttpRunner,
	signal: AbortSignal | undefined,
	apiKey?: string,
): Promise<ProviderResult> {
	// Reachable only through a direct call; `runSearch` rejects an unconfigured
	// provider before this runs.
	if (!apiKey) throw new HttpUnavailableError("Brave search needs an API key.");

	const url = buildBraveUrl(request.query, request.maxResults);
	const parsed = await requestJson(
		http,
		{
			url: url.toString(),
			headers: {
				Accept: "application/json",
				"X-Subscription-Token": apiKey,
				"User-Agent": config.userAgent,
			},
			timeoutMs: config.timeoutMs,
			maxBytes: config.maxBytes,
		},
		signal,
		"Brave",
	);
	return parseBrave(parsed, request.maxResults);
}

export const braveProvider: SearchProvider = {
	id: "brave",
	label: "Brave",
	isConfigured: (config) => Boolean(resolveSearchApiKey(config)),
	async search(ctx) {
		return searchBrave(ctx.request, ctx.config, ctx.http, ctx.signal, ctx.apiKey);
	},
};

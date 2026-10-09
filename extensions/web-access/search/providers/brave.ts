/**
 * Brave Search provider (keyed JSON API).
 *
 * `https://api.search.brave.com/res/v1/web/search` returns a general web-results
 * list. It requires an API key, sent as the `X-Subscription-Token` header and
 * resolved from `search.apiKeyEnv` (preferred) or `search.apiKey`.
 */

import { HttpUnavailableError, type HttpRunner } from "../../http.ts";
import type { SearchProvider, ProviderResult } from "../provider.ts";
import { resolveSearchApiKey, type WebSearchConfig } from "../config.ts";
import { asRecord, asString } from "../json.ts";
import type { SearchResult } from "../types.ts";

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

	const results: SearchResult[] = [];
	const seen = new Set<string>();
	for (const entry of raw) {
		const record = asRecord(entry);
		const url = asString(record.url);
		const title = asString(record.title);
		if (!url || !title || seen.has(url)) continue;
		seen.add(url);
		results.push({ title, url, snippet: asString(record.description) });
		if (results.length >= maxResults) break;
	}

	return { answer: "", results };
}

/** Fetch and parse one Brave web search. */
export async function searchBrave(
	query: string,
	maxResults: number,
	config: WebSearchConfig,
	http: HttpRunner,
	signal: AbortSignal | undefined,
	apiKey: string | undefined,
): Promise<ProviderResult> {
	if (!apiKey) throw new HttpUnavailableError("Brave search needs an API key.");

	const url = buildBraveUrl(query, maxResults);
	const response = await http(
		{
			url: url.toString(),
			method: "GET",
			headers: {
				Accept: "application/json",
				"X-Subscription-Token": apiKey,
				"User-Agent": config.userAgent,
			},
			timeoutMs: config.timeoutMs,
			maxBytes: config.maxBytes,
		},
		signal,
	);
	if (response.status < 200 || response.status >= 300) {
		throw new HttpUnavailableError(`Brave returned HTTP ${response.status}.`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(response.body);
	} catch {
		throw new HttpUnavailableError("Brave returned invalid JSON.");
	}
	return parseBrave(parsed, maxResults);
}

export const braveProvider: SearchProvider = {
	id: "brave",
	label: "Brave",
	isConfigured: (config) => Boolean(resolveSearchApiKey(config)),
	async search(ctx) {
		return searchBrave(ctx.request.query, ctx.request.maxResults, ctx.config, ctx.http, ctx.signal, ctx.apiKey);
	},
};

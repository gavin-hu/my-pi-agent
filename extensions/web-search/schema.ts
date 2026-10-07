/**
 * Parameter schema, output schema, and request resolution for `web_search`.
 *
 * Pure validation: invalid input throws a model-readable `Error` before any
 * network call, so the model can retry with a corrected query.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { MAX_RESULTS, type WebSearchConfig } from "./config.ts";
import type { SafeSearch, SearchRequest } from "./types.ts";

export const SAFE_SEARCH_VALUES = ["strict", "moderate", "off"] as const;
export const MAX_QUERY_LENGTH = 400;
const REGION_PATTERN = /^(wt-wt|[a-z]{2}-[a-z]{2})$/i;

export const WebSearchParams = Type.Object({
	query: Type.String({
		minLength: 1,
		maxLength: MAX_QUERY_LENGTH,
		description: "Search query. Works for Chinese and English (and other languages).",
	}),
	maxResults: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: MAX_RESULTS,
			description: `Number of results to return (1-${MAX_RESULTS}). Defaults to the configured value.`,
		}),
	),
	region: Type.Optional(
		Type.String({
			description: 'DuckDuckGo region code, for example "wt-wt" (any region), "cn-zh", or "us-en".',
		}),
	),
	safeSearch: Type.Optional(StringEnum(SAFE_SEARCH_VALUES, { description: "Safe-search level. Defaults to the configured value." })),
});

export type WebSearchArgs = Static<typeof WebSearchParams>;

const ResultItem = Type.Object({
	title: Type.String(),
	url: Type.String(),
	snippet: Type.String(),
});

export const WebSearchOutput = Type.Object({
	query: Type.String(),
	provider: Type.String(),
	results: Type.Array(ResultItem),
	truncated: Type.Boolean(),
	fetchedAt: Type.String(),
});

export type WebSearchStructured = Static<typeof WebSearchOutput>;

/**
 * Merge tool arguments with config defaults.
 *
 * `maxResults` is clamped to `[1, config.maxResults]`, so per-call overrides can
 * only ask for fewer, not for more than the configured ceiling.
 */
export function resolveRequest(args: WebSearchArgs, config: WebSearchConfig): SearchRequest {
	const query = typeof args.query === "string" ? args.query.trim() : "";
	if (!query) throw new Error("query is required.");
	if (query.length > MAX_QUERY_LENGTH) {
		throw new Error(`query is longer than ${MAX_QUERY_LENGTH} characters.`);
	}

	const requested = typeof args.maxResults === "number" ? args.maxResults : config.maxResults;
	const maxResults = Math.min(config.maxResults, MAX_RESULTS, Math.max(1, Math.round(requested)));

	let region = config.region;
	if (typeof args.region === "string" && args.region.trim()) {
		const candidate = args.region.trim().toLowerCase();
		if (!REGION_PATTERN.test(candidate)) {
			throw new Error('region must look like "wt-wt", "cn-zh", or "us-en".');
		}
		region = candidate;
	}

	const requestedSafeSearch = typeof args.safeSearch === "string" ? args.safeSearch.toLowerCase() : "";
	const safeSearch: SafeSearch = (SAFE_SEARCH_VALUES as readonly string[]).includes(requestedSafeSearch)
		? (requestedSafeSearch as SafeSearch)
		: config.safeSearch;

	return { query, maxResults, region, safeSearch };
}

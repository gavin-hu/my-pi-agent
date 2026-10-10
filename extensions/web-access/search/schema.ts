/**
 * Parameter schema, output schema, and request resolution for `web_search`.
 *
 * Pure validation: invalid input throws a model-readable `Error` before any
 * network call, so the model can retry with a corrected query.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { MAX_RESULTS, type WebSearchConfig } from "./config.ts";
import { SEARCH_PROVIDER_NAMES, type SearchRequest } from "./types.ts";

const MAX_QUERY_LENGTH = 400;

export const WebSearchParams = Type.Object({
	query: Type.String({
		minLength: 1,
		maxLength: MAX_QUERY_LENGTH,
		description: "Search query (any language).",
	}),
	maxResults: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: MAX_RESULTS,
			description: `Number of results to return (1-${MAX_RESULTS}). Defaults to the configured value.`,
		}),
	),
});

export type WebSearchArgs = Static<typeof WebSearchParams>;

const ResultItem = Type.Object({
	title: Type.String(),
	url: Type.String(),
	snippet: Type.String(),
});

export const WebSearchOutput = Type.Object({
	query: Type.String(),
	provider: StringEnum(SEARCH_PROVIDER_NAMES),
	answer: Type.String(),
	results: Type.Array(ResultItem),
	truncated: Type.Boolean(),
	fetchedAt: Type.String(),
});

/** The output shape, derived from the runtime schema so the two cannot drift. */
export type SearchResponse = Static<typeof WebSearchOutput>;

/**
 * Merge tool arguments with config defaults. `maxResults` is clamped to
 * `[1, config.maxResults]`, so a per-call override can only ask for fewer.
 */
export function resolveRequest(args: WebSearchArgs, config: WebSearchConfig): SearchRequest {
	const query = typeof args.query === "string" ? args.query.trim() : "";
	if (!query) throw new Error("query is required.");
	if (query.length > MAX_QUERY_LENGTH) {
		throw new Error(`query is longer than ${MAX_QUERY_LENGTH} characters.`);
	}

	const requested = typeof args.maxResults === "number" ? args.maxResults : config.maxResults;
	const maxResults = Math.min(config.maxResults, Math.max(1, Math.round(requested)));

	return { query, maxResults };
}

/**
 * Shared data types for the web-search extension.
 *
 * Plain data only: `details` and the codemode `structuredContent` both use
 * `SearchResponse`, so it stays serialisable by construction.
 */

/** Which backend produced the result. */
export type SearchProvider = "duckduckgo" | "wikipedia" | "none";

/** Which backend(s) to try. */
export type SearchSource = "auto" | "instant" | "wikipedia";

/** One result: a Wikipedia page or a DuckDuckGo instant-answer topic. */
export type SearchResult = {
	title: string;
	url: string;
	snippet: string;
};

/** A fully resolved search request. */
export interface SearchRequest {
	query: string;
	maxResults: number;
	source: SearchSource;
}

/** The result of one search, as returned in `details` and `structuredContent`. */
export type SearchResponse = {
	query: string;
	provider: SearchProvider;
	/** Instant-answer text, when DuckDuckGo provided one. */
	answer: string;
	results: SearchResult[];
	/** True when the model-facing text was cut short. */
	truncated: boolean;
	/** ISO-8601 timestamp of when the search completed. */
	fetchedAt: string;
};

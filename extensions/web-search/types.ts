/**
 * Shared data types for the web-search extension.
 *
 * Everything here is plain data: no host APIs, no I/O, no terminal. The tool
 * result (`details`) and the codemode `structuredContent` both use
 * `SearchResponse`, so it stays serialisable by construction.
 */

/** DuckDuckGo safe-search setting, mapped to the `kp` query parameter. */
export type SafeSearch = "strict" | "moderate" | "off";

/** One organic search result. */
export type SearchResult = {
	/** Plain-text title (HTML stripped, entities decoded). */
	title: string;
	/** Absolute result URL (redirect wrappers resolved). */
	url: string;
	/** Plain-text snippet, empty when DuckDuckGo provided none. */
	snippet: string;
};

/** A fully resolved search request: tool arguments merged with config defaults. */
export interface SearchRequest {
	query: string;
	maxResults: number;
	region: string;
	safeSearch: SafeSearch;
}

/** The result of one search, as returned in `details` and `structuredContent`. */
export type SearchResponse = {
	query: string;
	provider: "duckduckgo";
	results: SearchResult[];
	/** True when the model-facing text was cut short (char budget or result cap). */
	truncated: boolean;
	/** ISO-8601 timestamp of when the search completed. */
	fetchedAt: string;
};

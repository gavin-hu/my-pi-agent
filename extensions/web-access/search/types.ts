/**
 * Data types for the `web_search` tool of the web-access extension.
 *
 * Plain data only. `SEARCH_PROVIDER_IDS` is the canonical list of backends;
 * `registry.ts` implements one entry per id, and `schema.ts` builds its enum
 * from `SEARCH_PROVIDER_NAMES`, so the three cannot drift apart.
 */

/** Every backend id the registry must implement, in default-preference order. */
export const SEARCH_PROVIDER_IDS = ["duckduckgo", "searxng", "brave"] as const;

/** A backend id. */
export type SearchProviderId = (typeof SEARCH_PROVIDER_IDS)[number];

/** The `provider` field of a response: a backend id, or `"none"` for no results. */
export const SEARCH_PROVIDER_NAMES = [...SEARCH_PROVIDER_IDS, "none"] as const;

/** A backend id or the `"none"` no-results marker. */
export type SearchProviderName = (typeof SEARCH_PROVIDER_NAMES)[number];

/** One result: a title, its canonical URL, and a snippet. */
export type SearchResult = {
	title: string;
	url: string;
	snippet: string;
};

/** A fully resolved search request. */
export interface SearchRequest {
	query: string;
	maxResults: number;
}

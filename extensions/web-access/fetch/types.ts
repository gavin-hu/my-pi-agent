/**
 * Data types for the `web_fetch` tool of the web-access extension.
 *
 * `details` and the codemode `structuredContent` both use `FetchResponse`, so it
 * is serialisable by construction. `text` is the returned slice (not the whole
 * page) to keep the payload bounded.
 */

export type FetchResponse = {
	/** The requested URL. */
	url: string;
	/** The URL after redirects. */
	finalUrl: string;
	/** Page title, when it was HTML with one. */
	title: string;
	status: number;
	contentType: string;
	/** The returned slice of extracted text. */
	text: string;
	/** Total length of the extracted text, in code points. */
	totalChars: number;
	/** Code-point offset this slice starts at. */
	startIndex: number;
	/** True when more text remains after this slice. */
	truncated: boolean;
	/** True when the page came from the in-process cache. */
	cached: boolean;
	/** Passages from `find`, or an empty array. */
	matches: { query: string; offset: number; passage: string }[];
	/** ISO-8601 timestamp of when the fetch completed. */
	fetchedAt: string;
	/** Error message when this URL failed; empty otherwise. */
	error: string;
};

/** The tool result: one entry per requested URL. */
export type FetchBatch = {
	pages: FetchResponse[];
};

/**
 * Input types for the `web_fetch` tool.
 *
 * The runtime output schema lives in `schema.ts`; `FetchResponse`/`FetchBatch`
 * are derived from it there. This file holds the validated request shape that
 * `page.ts` and `schema.ts` both consume.
 */

import type { FindMode } from "./find.ts";

/** A fully resolved fetch request, shared by `resolveRequest` and `runFetch`. */
export interface FetchRequest {
	urls: string[];
	method: "GET" | "POST";
	headers: Record<string, string>;
	body?: string;
	render?: boolean;
	startIndex: number;
	maxChars: number;
	find: string[];
	mode: FindMode;
	contextChars: number;
	maxMatches: number;
	refresh: boolean;
	/** True when the request may be served from the page cache (GET, no custom headers or body). */
	cacheable: boolean;
}

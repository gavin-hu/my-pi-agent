/**
 * The shared JSON boundary for `web_search`.
 *
 * `requestJson` is the one place a provider turns a URL into parsed JSON, so the
 * status check and the parse error cannot drift between backends. `collectResults`
 * is the one place raw entries become de-duplicated `SearchResult`s, so every
 * provider holds the same guarantee: a result has a title and an http(s) URL, and
 * no URL repeats. `asString`/`asRecord` narrow the loosely-typed JSON defensively,
 * so a missing or wrong-typed field becomes `""`/`{}` instead of throwing.
 */

import { HttpUnavailableError, type HttpRunner } from "../http.ts";
import type { SearchResult } from "./types.ts";

/** A trimmed string, or `""` for any non-string. */
export function asString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** An object, or `{}` for null and primitives. Arrays are objects here too. */
export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** A provider JSON GET: the URL, headers, and limits; the method is always GET. */
export interface JsonRequest {
	url: string;
	headers: Record<string, string>;
	timeoutMs: number;
	maxBytes: number;
}

/**
 * Fetch and parse one provider JSON document. A non-2xx response or unparseable
 * body becomes an `HttpUnavailableError` naming the provider; `hint` is appended
 * to the invalid-JSON message (for example SearXNG's `format=json` note).
 */
export async function requestJson(
	http: HttpRunner,
	request: JsonRequest,
	signal: AbortSignal | undefined,
	label: string,
	hint = "",
): Promise<unknown> {
	const response = await http({ ...request, method: "GET" }, signal);
	if (response.status < 200 || response.status >= 300) {
		throw new HttpUnavailableError(`${label} returned HTTP ${response.status}.`);
	}
	try {
		return JSON.parse(response.body);
	} catch {
		throw new HttpUnavailableError(`${label} returned invalid JSON${hint ? ` (${hint})` : ""}.`);
	}
}

/**
 * Map raw provider entries to results, dropping any that have no title, a
 * non-http(s) URL, or a URL already seen, and capping the list at `maxResults`.
 */
export function collectResults(
	entries: unknown[],
	maxResults: number,
	map: (entry: Record<string, unknown>) => SearchResult,
): SearchResult[] {
	const results: SearchResult[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		if (results.length >= maxResults) break;
		const { title, url, snippet } = map(asRecord(entry));
		if (!title || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
		seen.add(url);
		results.push({ title, url, snippet });
	}
	return results;
}

/**
 * Wikipedia search fallback.
 *
 * Keyless and fetch-only. Uses the MediaWiki `generator=search` API with
 * `prop=extracts&exintro=1&explaintext=1`, so snippets are plain text (no HTML
 * to scrape) and each page comes with its canonical URL.
 */

import { HttpUnavailableError } from "../_shared/http.ts";
import type { HttpRunner } from "../_shared/http.ts";
import { asRecord, asString } from "./json.ts";
import type { SearchResult } from "./types.ts";

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;

/** Pick a Wikipedia language: an explicit code, or zh for Han text else en. */
export function wikipediaLangFor(query: string, configured: string): string {
	if (configured && configured !== "auto") return configured;
	return HAN.test(query) ? "zh" : "en";
}

/** Resolve the API endpoint, substituting `{lang}` when present. */
export function wikipediaEndpointFor(template: string, lang: string): string {
	return template.includes("{lang}") ? template.replaceAll("{lang}", lang) : template;
}

/** Turn a MediaWiki query response into a ranked list of results. */
export function parseWikipedia(json: unknown, maxResults: number): SearchResult[] {
	const pages = asRecord(asRecord(asRecord(json).query).pages);
	const entries = Object.values(pages).map(asRecord);

	const ranked = entries
		.map((page, fallbackIndex) => ({ page, order: typeof page.index === "number" ? page.index : fallbackIndex }))
		.sort((a, b) => a.order - b.order);

	const results: SearchResult[] = [];
	const seen = new Set<string>();
	for (const { page } of ranked) {
		const url = asString(page.fullurl);
		const title = asString(page.title);
		if (!url || !title || seen.has(url)) continue;
		seen.add(url);
		const snippet = asString(page.extract).replace(/\s+/g, " ").trim();
		results.push({ title, url, snippet });
		if (results.length >= maxResults) break;
	}
	return results;
}

/** Search Wikipedia for `query`, returning up to `maxResults` results. */
export async function searchWikipedia(
	query: string,
	lang: string,
	maxResults: number,
	endpointTemplate: string,
	http: HttpRunner,
	signal: AbortSignal | undefined,
	options: { timeoutMs: number; maxBytes: number; userAgent?: string },
): Promise<SearchResult[]> {
	const url = new URL(wikipediaEndpointFor(endpointTemplate, lang));
	url.searchParams.set("action", "query");
	url.searchParams.set("format", "json");
	url.searchParams.set("generator", "search");
	url.searchParams.set("gsrsearch", query);
	url.searchParams.set("gsrlimit", String(maxResults));
	url.searchParams.set("prop", "extracts|info");
	url.searchParams.set("inprop", "url");
	url.searchParams.set("exintro", "1");
	url.searchParams.set("explaintext", "1");
	url.searchParams.set("exchars", "500");
	url.searchParams.set("redirects", "1");

	const headers: Record<string, string> = { Accept: "application/json" };
	if (options.userAgent) headers["User-Agent"] = options.userAgent;

	const response = await http(
		{ url: url.toString(), method: "GET", headers, timeoutMs: options.timeoutMs, maxBytes: options.maxBytes },
		signal,
	);
	if (response.status < 200 || response.status >= 300) {
		throw new HttpUnavailableError(`Wikipedia returned HTTP ${response.status}.`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(response.body);
	} catch {
		throw new HttpUnavailableError("Wikipedia returned invalid JSON.");
	}
	return parseWikipedia(parsed, maxResults);
}

/**
 * DuckDuckGo search provider — the keyless default, Instant Answer JSON API.
 *
 * `https://api.duckduckgo.com/?q=…&format=json&no_html=1&skip_disambig=1` is an
 * official, keyless JSON endpoint returning a direct answer and related topics.
 * It is deliberately the fallback for when nothing else is configured.
 *
 * Honest limitation: the Instant Answer API is not a general web-results list —
 * it has no pagination and no "blue links". Many queries return only an answer,
 * or nothing. Full result lists come from the SearXNG or Brave providers.
 */

import { HttpUnavailableError, type HttpRunner } from "../../http.ts";
import type { SearchProvider, ProviderResult } from "../provider.ts";
import type { WebSearchConfig } from "../config.ts";
import { asRecord, asString } from "../json.ts";
import type { SearchResult } from "../types.ts";

const IA_ENDPOINT = "https://api.duckduckgo.com/";

/** Build the Instant Answer request URL. */
export function buildDuckDuckGoUrl(query: string): URL {
	const url = new URL(IA_ENDPOINT);
	url.searchParams.set("q", query);
	url.searchParams.set("format", "json");
	url.searchParams.set("no_html", "1");
	url.searchParams.set("skip_disambig", "1");
	return url;
}

/** Decode the handful of HTML entities DuckDuckGo emits; unknown ones pass through. */
function decodeEntities(text: string): string {
	return text
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#0?39;|&apos;/gi, "'")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&");
}

/** Strip tags, decode entities, collapse whitespace, and trim. */
export function sanitizeText(raw: string): string {
	return decodeEntities(raw.replace(/<[^>]*>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Split an Instant Answer `Text` value into a title and a snippet. Related
 * topics arrive as HTML (`<a …>Title</a>description`), so the anchor text is the
 * title and whatever follows is the snippet.
 */
export function splitTitleAndSnippet(raw: string): { title: string; snippet: string } {
	const anchor = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(raw);
	if (anchor) {
		const title = sanitizeText(anchor[1] ?? "");
		const snippet = sanitizeText(raw.slice(anchor.index + anchor[0].length));
		return { title: title || snippet, snippet };
	}
	const text = sanitizeText(raw);
	return { title: text, snippet: "" };
}

/** Add one result if it has a title, an http(s) URL, and is not a duplicate. */
function pushResult(
	results: SearchResult[],
	seen: Set<string>,
	title: string,
	url: string,
	snippet: string,
	maxResults: number,
): void {
	if (results.length >= maxResults) return;
	if (!title || !/^https?:\/\//i.test(url) || seen.has(url)) return;
	seen.add(url);
	results.push({ title, url, snippet });
}

/** Turn an Instant Answer response into an answer plus de-duplicated results. */
export function parseDuckDuckGo(json: unknown, maxResults: number): ProviderResult {
	const data = asRecord(json);
	const answer = [asString(data.Answer), asString(data.AbstractText), asString(data.Definition)].find(Boolean) ?? "";

	const results: SearchResult[] = [];
	const seen = new Set<string>();
	const add = (entry: unknown) => {
		const record = asRecord(entry);
		const { title, snippet } = splitTitleAndSnippet(asString(record.Text));
		pushResult(results, seen, title, asString(record.FirstURL), snippet, maxResults);
	};

	if (Array.isArray(data.Results)) for (const entry of data.Results) add(entry);

	const walk = (entry: unknown) => {
		const record = asRecord(entry);
		if (Array.isArray(record.Topics)) {
			for (const nested of record.Topics) walk(nested);
		} else {
			add(record);
		}
	};
	if (Array.isArray(data.RelatedTopics)) for (const topic of data.RelatedTopics) walk(topic);

	return { answer, results };
}

/** Fetch and parse one Instant Answer search. */
export async function searchDuckDuckGo(
	query: string,
	maxResults: number,
	config: WebSearchConfig,
	http: HttpRunner,
	signal: AbortSignal | undefined,
): Promise<ProviderResult> {
	const url = buildDuckDuckGoUrl(query);
	const response = await http(
		{
			url: url.toString(),
			method: "GET",
			headers: { Accept: "application/json", "User-Agent": config.userAgent },
			timeoutMs: config.timeoutMs,
			maxBytes: config.maxBytes,
		},
		signal,
	);
	if (response.status < 200 || response.status >= 300) {
		throw new HttpUnavailableError(`DuckDuckGo returned HTTP ${response.status}.`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(response.body);
	} catch {
		throw new HttpUnavailableError("DuckDuckGo returned invalid JSON.");
	}
	return parseDuckDuckGo(parsed, maxResults);
}

export const duckDuckGoProvider: SearchProvider = {
	id: "duckduckgo",
	label: "DuckDuckGo",
	// Keyless and always available, so it is the provider of last resort.
	isConfigured: () => true,
	async search(ctx) {
		return searchDuckDuckGo(ctx.request.query, ctx.request.maxResults, ctx.config, ctx.http, ctx.signal);
	},
};

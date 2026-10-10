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

import { decodeEntities } from "../../html.ts";
import type { HttpRunner } from "../../http.ts";
import type { WebSearchConfig } from "../config.ts";
import { asRecord, asString, collectResults, requestJson } from "../json.ts";
import type { ProviderResult, SearchProvider } from "../provider.ts";
import type { SearchRequest } from "../types.ts";

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

/** Turn an Instant Answer response into an answer plus de-duplicated results. */
export function parseDuckDuckGo(json: unknown, maxResults: number): ProviderResult {
	const data = asRecord(json);
	const answer = [asString(data.Answer), asString(data.AbstractText), asString(data.Definition)].find(Boolean) ?? "";

	// `Results` first, then flattened `RelatedTopics`, preserving provider order.
	const entries: unknown[] = Array.isArray(data.Results) ? [...data.Results] : [];
	const walk = (entry: unknown) => {
		const record = asRecord(entry);
		if (Array.isArray(record.Topics)) {
			for (const nested of record.Topics) walk(nested);
		} else {
			entries.push(entry);
		}
	};
	if (Array.isArray(data.RelatedTopics)) for (const topic of data.RelatedTopics) walk(topic);

	const results = collectResults(entries, maxResults, (record) => {
		const { title, snippet } = splitTitleAndSnippet(asString(record.Text));
		return { title, url: asString(record.FirstURL), snippet };
	});

	return { answer, results };
}

/** Fetch and parse one Instant Answer search. */
export async function searchDuckDuckGo(
	request: SearchRequest,
	config: WebSearchConfig,
	http: HttpRunner,
	signal: AbortSignal | undefined,
	_apiKey?: string,
): Promise<ProviderResult> {
	const url = buildDuckDuckGoUrl(request.query);
	const parsed = await requestJson(
		http,
		{
			url: url.toString(),
			headers: { Accept: "application/json", "User-Agent": config.userAgent },
			timeoutMs: config.timeoutMs,
			maxBytes: config.maxBytes,
		},
		signal,
		"DuckDuckGo",
	);
	return parseDuckDuckGo(parsed, request.maxResults);
}

export const duckDuckGoProvider: SearchProvider = {
	id: "duckduckgo",
	label: "DuckDuckGo",
	// Keyless and always available, so it is the provider of last resort.
	isConfigured: () => true,
	async search(ctx) {
		return searchDuckDuckGo(ctx.request, ctx.config, ctx.http, ctx.signal, ctx.apiKey);
	},
};

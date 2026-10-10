/**
 * SearXNG search provider (JSON API).
 *
 * A keyless, self-hostable meta-search engine exposing a JSON API (`format=json`
 * must be enabled on the instance). Results and any direct `answers` are mapped
 * to the shared `SearchResult` shape. The instance is configured through
 * `search.endpoint`.
 */

import type { HttpRunner } from "../../http.ts";
import type { WebSearchConfig } from "../config.ts";
import { asRecord, asString, collectResults, requestJson } from "../json.ts";
import type { ProviderResult, SearchProvider } from "../provider.ts";
import type { SearchRequest } from "../types.ts";

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;

/** Pick a SearXNG language: an explicit code, or zh-CN for Han text else en. */
export function searxngLanguageFor(query: string, configured: string): string {
	if (configured && configured !== "auto") return configured;
	return HAN.test(query) ? "zh-CN" : "en";
}

interface SearxngUrlOptions {
	query: string;
	language: string;
	categories: string;
	safeSearch: number;
}

/** Build the `/search` request URL, tolerating an endpoint with or without a trailing slash. */
export function buildSearxngUrl(endpoint: string, options: SearxngUrlOptions): URL {
	const url = new URL("search", `${endpoint.replace(/\/+$/, "")}/`);
	url.searchParams.set("q", options.query);
	url.searchParams.set("format", "json");
	url.searchParams.set("categories", options.categories);
	url.searchParams.set("language", options.language);
	url.searchParams.set("safesearch", String(options.safeSearch));
	url.searchParams.set("pageno", "1");
	return url;
}

/** Turn a SearXNG JSON response into an answer plus de-duplicated results. */
export function parseSearxng(json: unknown, maxResults: number): ProviderResult {
	const data = asRecord(json);

	const answers = Array.isArray(data.answers) ? data.answers.map((entry) => asString(entry)).filter(Boolean) : [];
	const answer = answers[0] ?? "";

	const raw = Array.isArray(data.results) ? data.results : [];
	const results = collectResults(raw, maxResults, (record) => ({
		title: asString(record.title),
		url: asString(record.url),
		snippet: asString(record.content),
	}));

	return { answer, results };
}

/** Search SearXNG for one request, returning the answer and results. */
export async function searchSearxng(
	request: SearchRequest,
	config: WebSearchConfig,
	http: HttpRunner,
	signal: AbortSignal | undefined,
	apiKey?: string,
): Promise<ProviderResult> {
	const url = buildSearxngUrl(config.endpoint, {
		query: request.query,
		language: searxngLanguageFor(request.query, config.language),
		categories: config.categories,
		safeSearch: config.safeSearch,
	});

	const headers: Record<string, string> = {
		Accept: "application/json",
		"User-Agent": config.userAgent,
	};
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

	const parsed = await requestJson(
		http,
		{ url: url.toString(), headers, timeoutMs: config.timeoutMs, maxBytes: config.maxBytes },
		signal,
		"SearXNG",
		"is format=json enabled on the instance?",
	);
	return parseSearxng(parsed, request.maxResults);
}

export const searxngProvider: SearchProvider = {
	id: "searxng",
	label: "SearXNG",
	isConfigured: (config) => config.endpoint !== "",
	async search(ctx) {
		return searchSearxng(ctx.request, ctx.config, ctx.http, ctx.signal, ctx.apiKey);
	},
};

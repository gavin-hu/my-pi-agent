/**
 * SearXNG search provider (JSON API).
 *
 * A keyless, self-hostable meta-search engine exposing a JSON API (`format=json`
 * must be enabled on the instance). Results and any direct `answers` are mapped
 * to the shared `SearchResult` shape. The instance is configured through
 * `search.endpoint`.
 */

import { HttpUnavailableError, type HttpRunner } from "../../http.ts";
import type { SearchProvider } from "../provider.ts";
import type { WebSearchConfig } from "../config.ts";
import { asRecord, asString } from "../json.ts";
import type { SearchRequest, SearchResult } from "../types.ts";

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;

/** Pick a SearXNG language: an explicit code, or zh-CN for Han text else en. */
export function searxngLanguageFor(query: string, configured: string): string {
	if (configured && configured !== "auto") return configured;
	return HAN.test(query) ? "zh-CN" : "en";
}

export interface SearxngUrlOptions {
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

export interface SearxngParsed {
	answer: string;
	results: SearchResult[];
}

/** Turn a SearXNG JSON response into an answer plus de-duplicated results. */
export function parseSearxng(json: unknown, maxResults: number): SearxngParsed {
	const data = asRecord(json);

	const answers = Array.isArray(data.answers) ? data.answers.map((entry) => asString(entry)).filter(Boolean) : [];
	const answer = answers[0] ?? "";

	const raw = Array.isArray(data.results) ? data.results : [];
	const results: SearchResult[] = [];
	const seen = new Set<string>();
	for (const entry of raw) {
		const record = asRecord(entry);
		const url = asString(record.url);
		const title = asString(record.title);
		if (!url || !title || seen.has(url)) continue;
		seen.add(url);
		results.push({ title, url, snippet: asString(record.content) });
		if (results.length >= maxResults) break;
	}

	return { answer, results };
}

/** Search SearXNG for one request, returning the answer and results. */
export async function searchSearxng(
	request: SearchRequest,
	config: WebSearchConfig,
	http: HttpRunner,
	signal: AbortSignal | undefined,
	apiKey: string | undefined,
): Promise<SearxngParsed> {
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

	const response = await http(
		{ url: url.toString(), method: "GET", headers, timeoutMs: config.timeoutMs, maxBytes: config.maxBytes },
		signal,
	);
	if (response.status < 200 || response.status >= 300) {
		throw new HttpUnavailableError(`SearXNG returned HTTP ${response.status}.`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(response.body);
	} catch {
		throw new HttpUnavailableError("SearXNG returned invalid JSON (is format=json enabled on the instance?)");
	}

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

/**
 * Configuration for the `web_search` half of web-access.
 *
 * The top-level `config.ts` reads `web-access.json` and hands the `search`
 * object here; this module only validates and clamps it. Everything is clamped
 * so a typo cannot produce a nonsensical request.
 */

import { clampInteger, cleanString } from "../../../lib/config.ts";

export interface WebSearchConfig {
	/** Default number of results (1–MAX_RESULTS). */
	maxResults: number;
	/** Per-request timeout in milliseconds. */
	timeoutMs: number;
	/** Maximum response size in bytes for either backend. */
	maxBytes: number;
	/** Minimum spacing between requests in milliseconds. */
	minIntervalMs: number;
	/** Character budget for the model-facing text. */
	maxOutputChars: number;
	/** User-Agent sent with requests (Wikipedia asks for a descriptive one). */
	userAgent: string;
	/** Wikipedia language code, or "auto" to pick zh for CJK and en otherwise. */
	wikipediaLang: string;
	/** DuckDuckGo Instant Answer endpoint. */
	instantAnswerEndpoint: string;
	/** Wikipedia API endpoint; `{lang}` is replaced with the chosen language. */
	wikipediaEndpoint: string;
}

/** Hard cap on results, mirroring the tool parameter maximum. */
export const MAX_RESULTS = 20;

export const DEFAULT_SEARCH_CONFIG: WebSearchConfig = {
	maxResults: 8,
	timeoutMs: 15_000,
	maxBytes: 5_000_000,
	minIntervalMs: 500,
	maxOutputChars: 12_000,
	userAgent: "my-pi-agent/0.1 (+https://github.com/gavin-hu/my-pi-agent)",
	wikipediaLang: "auto",
	instantAnswerEndpoint: "https://api.duckduckgo.com/",
	wikipediaEndpoint: "https://{lang}.wikipedia.org/w/api.php",
};

const LANG_PATTERN = /^[a-z][a-z0-9-]{1,11}$/i;

function httpUrl(value: unknown, fallback: string): string {
	const candidate = cleanString(value, fallback);
	return /^https?:\/\//i.test(candidate) ? candidate : fallback;
}

/** Validate and clamp a raw config object over the defaults. */
export function normalizeSearchConfig(
	raw: Record<string, unknown> | undefined,
	base: WebSearchConfig = DEFAULT_SEARCH_CONFIG,
): WebSearchConfig {
	if (!raw) return base;

	const lang = cleanString(raw.wikipediaLang, base.wikipediaLang);

	return {
		maxResults: clampInteger(raw.maxResults, base.maxResults, 1, MAX_RESULTS),
		timeoutMs: clampInteger(raw.timeoutMs, base.timeoutMs, 1_000, 120_000),
		maxBytes: clampInteger(raw.maxBytes, base.maxBytes, 1_024, 50_000_000),
		minIntervalMs: clampInteger(raw.minIntervalMs, base.minIntervalMs, 0, 60_000),
		maxOutputChars: clampInteger(raw.maxOutputChars, base.maxOutputChars, 1_000, 100_000),
		userAgent: cleanString(raw.userAgent, base.userAgent),
		wikipediaLang: lang === "auto" || LANG_PATTERN.test(lang) ? lang : base.wikipediaLang,
		instantAnswerEndpoint: httpUrl(raw.instantAnswerEndpoint, base.instantAnswerEndpoint),
		wikipediaEndpoint: httpUrl(raw.wikipediaEndpoint, base.wikipediaEndpoint),
	};
}

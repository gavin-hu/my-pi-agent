/**
 * Configuration for the `web_search` half of web-access.
 *
 * The top-level `config.ts` reads `web-access.json` and hands the `search`
 * object here; this module only validates and clamps it. Everything is clamped
 * so a typo cannot produce a nonsensical request.
 */

import { clampInteger, cleanString } from "../../../lib/config.ts";
import { SEARCH_PROVIDER_IDS, type SearchProviderId } from "./types.ts";

/** `"auto"` picks the first configured provider; a named id forces one. */
export type SearchProviderChoice = "auto" | SearchProviderId;

export interface WebSearchConfig {
	/** `"auto"`, or the backend id to force (even when it is not configured). */
	provider: SearchProviderChoice;
	/** SearXNG base URL; `""` means unset and the SearXNG provider refuses to run. */
	endpoint: string;
	/** SearXNG language code, or "auto" to pick zh-CN for CJK and en otherwise. */
	language: string;
	/** SearXNG `safesearch` level (0 off, 1 moderate, 2 strict). */
	safeSearch: number;
	/** SearXNG `categories` (for example "general"). */
	categories: string;
	/** Environment variable holding an optional API key; preferred over `apiKey`. */
	apiKeyEnv: string;
	/** Literal API key fallback, used by keyed providers (Brave) and auth proxies. */
	apiKey: string;
	/** Default number of results (1–MAX_RESULTS). */
	maxResults: number;
	/** Per-request timeout in milliseconds. */
	timeoutMs: number;
	/** Maximum response size in bytes. */
	maxBytes: number;
	/** Minimum spacing between requests in milliseconds. */
	minIntervalMs: number;
	/** Character budget for the model-facing text. */
	maxOutputChars: number;
	/** User-Agent sent with requests. */
	userAgent: string;
}

/** Hard cap on results, mirroring the tool parameter maximum. */
export const MAX_RESULTS = 20;

export const DEFAULT_SEARCH_CONFIG: WebSearchConfig = {
	provider: "auto",
	endpoint: "",
	language: "auto",
	safeSearch: 0,
	categories: "general",
	apiKeyEnv: "",
	apiKey: "",
	maxResults: 8,
	timeoutMs: 15_000,
	maxBytes: 5_000_000,
	minIntervalMs: 500,
	maxOutputChars: 12_000,
	userAgent: "my-pi-agent/0.1 (+https://github.com/gavin-hu/my-pi-agent)",
};

const LANG_PATTERN = /^[a-z][a-z0-9-]{1,11}$/i;

const PROVIDER_IDS = new Set<string>(SEARCH_PROVIDER_IDS);

/** A valid http(s) URL, `""` to clear, or the fallback for nonsense. */
function endpointValue(value: unknown, fallback: string): string {
	if (value === undefined || typeof value !== "string") return fallback;
	const candidate = value.trim();
	if (!candidate) return "";
	return /^https?:\/\//i.test(candidate) ? candidate : fallback;
}

/** `"auto"` or a known backend id; anything else falls back to the base. */
function providerValue(value: unknown, fallback: SearchProviderChoice): SearchProviderChoice {
	if (typeof value !== "string") return fallback;
	const candidate = value.trim();
	if (candidate === "auto") return "auto";
	return PROVIDER_IDS.has(candidate) ? (candidate as SearchProviderId) : fallback;
}

/** Validate and clamp a raw config object over the defaults. */
export function normalizeSearchConfig(
	raw: Record<string, unknown> | undefined,
	base: WebSearchConfig = DEFAULT_SEARCH_CONFIG,
): WebSearchConfig {
	if (!raw) return base;

	const language = cleanString(raw.language, base.language);

	return {
		provider: providerValue(raw.provider, base.provider),
		endpoint: endpointValue(raw.endpoint, base.endpoint),
		language: language === "auto" || LANG_PATTERN.test(language) ? language : base.language,
		safeSearch: clampInteger(raw.safeSearch, base.safeSearch, 0, 2),
		categories: cleanString(raw.categories, base.categories),
		apiKeyEnv: cleanString(raw.apiKeyEnv, base.apiKeyEnv),
		apiKey: cleanString(raw.apiKey, base.apiKey),
		maxResults: clampInteger(raw.maxResults, base.maxResults, 1, MAX_RESULTS),
		timeoutMs: clampInteger(raw.timeoutMs, base.timeoutMs, 1_000, 120_000),
		maxBytes: clampInteger(raw.maxBytes, base.maxBytes, 1_024, 50_000_000),
		minIntervalMs: clampInteger(raw.minIntervalMs, base.minIntervalMs, 0, 60_000),
		maxOutputChars: clampInteger(raw.maxOutputChars, base.maxOutputChars, 1_000, 100_000),
		userAgent: cleanString(raw.userAgent, base.userAgent),
	};
}

/** Resolve the optional API key: environment variable first, literal fallback. */
export function resolveSearchApiKey(config: WebSearchConfig): string | undefined {
	const fromEnv = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;
	const value = (fromEnv ?? "").trim() || config.apiKey.trim();
	return value || undefined;
}

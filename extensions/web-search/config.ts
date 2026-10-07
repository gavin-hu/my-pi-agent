/**
 * Configuration for the web-search extension.
 *
 * Merged from ~/.pi/agent/web-search.json (global) and <cwd>/.pi/web-search.json
 * (project). Project values win. Everything is validated and clamped so a typo
 * in the config file cannot produce a nonsensical request.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SafeSearch } from "./types.ts";

export interface WebSearchConfig {
	/** Default number of results requested (1–MAX_RESULTS). */
	maxResults: number;
	/** DuckDuckGo `kl` region, e.g. "wt-wt" (all), "cn-zh", "us-en". */
	region: string;
	/** `Accept-Language` header; nudges ranking for bilingual queries. */
	acceptLanguage: string;
	/** DuckDuckGo `kp` safe-search level. */
	safeSearch: SafeSearch;
	/** Per-request timeout in milliseconds. */
	timeoutMs: number;
	/** Minimum spacing between requests in milliseconds (politeness throttle). */
	minIntervalMs: number;
	/** DuckDuckGo classic HTML endpoint. */
	endpoint: string;
	/** curl binary used for the request (name on PATH or absolute path). */
	curlPath: string;
	/** Override the browser User-Agent; null uses DEFAULT_USER_AGENT. */
	userAgent: string | null;
	/** Character budget for the model-facing text. */
	maxOutputChars: number;
}

/** Hard cap on results, mirroring the tool parameter maximum. */
export const MAX_RESULTS = 20;
/** Default browser User-Agent used for DuckDuckGo's HTML endpoint. */
export const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const DEFAULT_CONFIG: WebSearchConfig = {
	maxResults: 8,
	region: "wt-wt",
	acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
	safeSearch: "moderate",
	timeoutMs: 20_000,
	minIntervalMs: 1_000,
	endpoint: "https://html.duckduckgo.com/html/",
	curlPath: "curl",
	userAgent: null,
	maxOutputChars: 12_000,
};

const SAFE_SEARCH_VALUES: readonly SafeSearch[] = ["strict", "moderate", "off"];
const REGION_PATTERN = /^(wt-wt|[a-z]{2}-[a-z]{2})$/i;

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, Math.round(number)));
}

function cleanString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readJson(path: string): Record<string, unknown> | undefined {
	try {
		if (!existsSync(path)) return undefined;
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/** Validate and clamp a raw config object over the defaults. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: WebSearchConfig = DEFAULT_CONFIG): WebSearchConfig {
	if (!raw) return base;

	const region = cleanString(raw.region, base.region);
	const safeSearch = cleanString(raw.safeSearch, base.safeSearch).toLowerCase();
	const endpoint = cleanString(raw.endpoint, base.endpoint);
	const userAgent = raw.userAgent;

	return {
		maxResults: clampInteger(raw.maxResults, base.maxResults, 1, MAX_RESULTS),
		region: REGION_PATTERN.test(region) ? region.toLowerCase() : base.region,
		acceptLanguage: cleanString(raw.acceptLanguage, base.acceptLanguage),
		safeSearch: (SAFE_SEARCH_VALUES as readonly string[]).includes(safeSearch)
			? (safeSearch as SafeSearch)
			: base.safeSearch,
		timeoutMs: clampInteger(raw.timeoutMs, base.timeoutMs, 1_000, 120_000),
		minIntervalMs: clampInteger(raw.minIntervalMs, base.minIntervalMs, 0, 60_000),
		endpoint: /^https?:\/\//i.test(endpoint) ? endpoint : base.endpoint,
		curlPath: cleanString(raw.curlPath, base.curlPath),
		userAgent: typeof userAgent === "string" && userAgent.trim() ? userAgent.trim() : base.userAgent,
		maxOutputChars: clampInteger(raw.maxOutputChars, base.maxOutputChars, 1_000, 100_000),
	};
}

/**
 * Load the effective config for a working directory: defaults, then the global
 * file, then the project file. Missing or malformed files are ignored.
 */
export function loadConfig(cwd: string): WebSearchConfig {
	let config = DEFAULT_CONFIG;
	config = normalizeConfig(readJson(join(getAgentDir(), "web-search.json")), config);
	config = normalizeConfig(readJson(join(cwd, CONFIG_DIR_NAME, "web-search.json")), config);
	return config;
}

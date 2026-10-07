/**
 * Configuration for the web-fetch extension.
 *
 * Merged from ~/.pi/agent/web-fetch.json (global) and <cwd>/.pi/web-fetch.json
 * (project). Project values win. Everything is validated and clamped.
 */

import { clampInteger, cleanString, loadConfigFile } from "../_shared/config.ts";

export interface WebFetchConfig {
	/** Per-request timeout in milliseconds. */
	timeoutMs: number;
	/** Maximum response size in bytes. */
	maxBytes: number;
	/** Default character budget for the returned slice. */
	maxOutputChars: number;
	/** User-Agent sent with requests. */
	userAgent: string;
	/** Accept-Language header. */
	acceptLanguage: string;
	/** Allow loopback/private/internal targets (disables the SSRF guard). */
	allowPrivateHosts: boolean;
	/** Cache extracted pages for the session. */
	cacheEnabled: boolean;
	/** Cache entry lifetime in ms (0 = never expire). */
	cacheTtlMs: number;
	/** Maximum cached pages. */
	cacheMaxEntries: number;
	/** Maximum total cached text bytes. */
	cacheMaxBytes: number;
}

export const DEFAULT_CONFIG: WebFetchConfig = {
	timeoutMs: 20_000,
	maxBytes: 5_000_000,
	maxOutputChars: 20_000,
	userAgent: "my-pi-agent/0.1 (+https://github.com/gavin-hu/my-pi-agent)",
	acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
	allowPrivateHosts: false,
	cacheEnabled: true,
	cacheTtlMs: 300_000,
	cacheMaxEntries: 8,
	cacheMaxBytes: 8_000_000,
};

/** Validate and clamp a raw config object over the defaults. */
export function normalizeConfig(
	raw: Record<string, unknown> | undefined,
	base: WebFetchConfig = DEFAULT_CONFIG,
): WebFetchConfig {
	if (!raw) return base;
	return {
		timeoutMs: clampInteger(raw.timeoutMs, base.timeoutMs, 1_000, 120_000),
		maxBytes: clampInteger(raw.maxBytes, base.maxBytes, 1_024, 50_000_000),
		maxOutputChars: clampInteger(raw.maxOutputChars, base.maxOutputChars, 500, 100_000),
		userAgent: cleanString(raw.userAgent, base.userAgent),
		acceptLanguage: cleanString(raw.acceptLanguage, base.acceptLanguage),
		allowPrivateHosts: typeof raw.allowPrivateHosts === "boolean" ? raw.allowPrivateHosts : base.allowPrivateHosts,
		cacheEnabled: typeof raw.cacheEnabled === "boolean" ? raw.cacheEnabled : base.cacheEnabled,
		cacheTtlMs: clampInteger(raw.cacheTtlMs, base.cacheTtlMs, 0, 3_600_000),
		cacheMaxEntries: clampInteger(raw.cacheMaxEntries, base.cacheMaxEntries, 1, 50),
		cacheMaxBytes: clampInteger(raw.cacheMaxBytes, base.cacheMaxBytes, 1_024, 50_000_000),
	};
}

/**
 * Load the effective config for a working directory: defaults, then the global
 * file, then the project file. Missing or malformed files are ignored.
 */
export function loadConfig(cwd: string): WebFetchConfig {
	return loadConfigFile(cwd, "web-fetch.json", DEFAULT_CONFIG, normalizeConfig);
}

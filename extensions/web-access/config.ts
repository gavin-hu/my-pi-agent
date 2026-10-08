/**
 * Configuration for the web-access extension.
 *
 * One file, `~/.pi/agent/web-access.json` merged with `<cwd>/.pi/web-access.json`
 * (project wins), holding a `search` section and a `fetch` section. Each section
 * is validated and clamped by its own module; unknown keys are ignored.
 */

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { readJson } from "../_shared/config.ts";
import { DEFAULT_FETCH_CONFIG, normalizeFetchConfig, type WebFetchConfig } from "./fetch/config.ts";
import { DEFAULT_SEARCH_CONFIG, normalizeSearchConfig, type WebSearchConfig } from "./search/config.ts";

export interface WebAccessConfig {
	search: WebSearchConfig;
	fetch: WebFetchConfig;
}

function section(raw: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
	const value = raw?.[key];
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** The global file first, then the project file so it wins. */
function configFiles(cwd: string): string[] {
	return [join(getAgentDir(), "web-access.json"), join(cwd, CONFIG_DIR_NAME, "web-access.json")];
}

/** Load and clamp the `search` section for a working directory. */
export function loadSearchConfig(cwd: string): WebSearchConfig {
	let config = DEFAULT_SEARCH_CONFIG;
	for (const file of configFiles(cwd)) config = normalizeSearchConfig(section(readJson(file), "search"), config);
	return config;
}

/** Load and clamp the `fetch` section for a working directory. */
export function loadFetchConfig(cwd: string): WebFetchConfig {
	let config = DEFAULT_FETCH_CONFIG;
	for (const file of configFiles(cwd)) config = normalizeFetchConfig(section(readJson(file), "fetch"), config);
	return config;
}

/** Load both sections for a working directory. */
export function loadConfig(cwd: string): WebAccessConfig {
	return { search: loadSearchConfig(cwd), fetch: loadFetchConfig(cwd) };
}

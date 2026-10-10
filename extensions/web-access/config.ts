/**
 * Configuration for the web-access extension.
 *
 * One file, `~/.pi/agent/web-access.json` merged with `<cwd>/.pi/web-access.json`
 * (project wins), holding a `search` section and a `fetch` section. Each section
 * is validated and clamped by its own module; unknown keys are ignored, and the
 * file pair is read by the shared `loadConfigFile` in `lib/config.ts`.
 */

import { loadConfigFile } from "../../lib/config.ts";
import { DEFAULT_FETCH_CONFIG, normalizeFetchConfig, type WebFetchConfig } from "./fetch/config.ts";
import { DEFAULT_SEARCH_CONFIG, normalizeSearchConfig, type WebSearchConfig } from "./search/config.ts";

const CONFIG_FILE = "web-access.json";

/** The named section of a config object, or `undefined` when it is missing or not an object. */
function section(raw: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
	const value = raw?.[key];
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Load and clamp the `search` section for a working directory. */
export function loadSearchConfig(cwd: string): WebSearchConfig {
	return loadConfigFile(cwd, CONFIG_FILE, DEFAULT_SEARCH_CONFIG, (raw, base) =>
		normalizeSearchConfig(section(raw, "search"), base),
	);
}

/** Load and clamp the `fetch` section for a working directory. */
export function loadFetchConfig(cwd: string): WebFetchConfig {
	return loadConfigFile(cwd, CONFIG_FILE, DEFAULT_FETCH_CONFIG, (raw, base) =>
		normalizeFetchConfig(section(raw, "fetch"), base),
	);
}

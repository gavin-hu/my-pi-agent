/**
 * Configuration for the web-access extension.
 *
 * The `web-access` section of the shared `bytefly.json` (global then project,
 * project wins), holding a
 * `search` group and a `fetch` group. Each group is validated and clamped by
 * its own module; unknown keys are ignored.
 */

import { configSection, loadConfigSection } from "../../lib/config.ts";
import { DEFAULT_FETCH_CONFIG, normalizeFetchConfig, type WebFetchConfig } from "./fetch/config.ts";
import { DEFAULT_SEARCH_CONFIG, normalizeSearchConfig, type WebSearchConfig } from "./search/config.ts";

/** Defaults for the whole `web-access` section, so the environment walk sees both groups. */
const DEFAULT_WEB_ACCESS = { search: DEFAULT_SEARCH_CONFIG, fetch: DEFAULT_FETCH_CONFIG };

/** Validate both groups over the running value. */
function normalizeWebAccess(
	raw: Record<string, unknown> | undefined,
	base: { search: WebSearchConfig; fetch: WebFetchConfig },
): { search: WebSearchConfig; fetch: WebFetchConfig } {
	return {
		search: normalizeSearchConfig(configSection(raw, "search"), base.search),
		fetch: normalizeFetchConfig(configSection(raw, "fetch"), base.fetch),
	};
}

/** Load and clamp the `search` group for a working directory. */
export function loadSearchConfig(cwd: string): WebSearchConfig {
	return loadConfigSection(cwd, "web-access", DEFAULT_WEB_ACCESS, normalizeWebAccess).search;
}

/** Load and clamp the `fetch` group for a working directory. */
export function loadFetchConfig(cwd: string): WebFetchConfig {
	return loadConfigSection(cwd, "web-access", DEFAULT_WEB_ACCESS, normalizeWebAccess).fetch;
}

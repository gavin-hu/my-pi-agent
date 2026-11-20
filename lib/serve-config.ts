/**
 * The session's one port and its one switch: the `serve` section of the shared
 * `bytefly.json` (global then project, project wins).
 *
 * `port` — `0`, the default — takes the project's own port: its repository key hashed
 * into the band `lib/http/port.ts` holds, so a session that starts again lands where a
 * bookmark already points and two repositories do not compete for one number. A
 * positive value pins the session's server, so every page it serves keeps the address a
 * bookmark already points at. Either way a port another process holds costs the start
 * its OS-chosen fallback — unless it was pinned, which fails the start rather than
 * moving the pages out from under the bookmark.
 *
 * `autoOpen` is the project's answer to "does a page open a tab on this machine".
 * `/browse` and `/board` read it; `false` prints the URL instead, for a headless box or
 * one whose pages are read from elsewhere. `/plan`'s browser step is not gated, because
 * the tab there is the step and not a convenience.
 *
 * Both live here rather than beside a page because more than one extension answers
 * them, and only one module may own a section.
 */

import { asBoolean, clampInteger } from "./json.ts";
import { loadConfigSection } from "./config.ts";

/** The `serve` section. */
export interface ServeConfig {
	/** TCP port on `127.0.0.1`; `0` takes the project's port, a positive value pins it. */
	port: number;
	/** Whether `/browse` and `/board` open the page in the default browser. */
	autoOpen: boolean;
}

export const DEFAULT_SERVE_CONFIG: ServeConfig = { port: 0, autoOpen: true };

/** Validate and clamp a raw config object over the defaults. */
export function normalizeServeConfig(
	raw: Record<string, unknown> | undefined,
	base: ServeConfig = DEFAULT_SERVE_CONFIG,
): ServeConfig {
	if (!raw) return base;
	return {
		port: clampInteger(raw.port, base.port, 0, 65_535),
		autoOpen: asBoolean(raw.autoOpen, base.autoOpen),
	};
}

/** Load the effective config for a working directory. */
export function loadServeConfig(cwd: string): ServeConfig {
	return loadConfigSection(cwd, "serve", DEFAULT_SERVE_CONFIG, normalizeServeConfig);
}

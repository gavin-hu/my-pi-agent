/**
 * The session's one port: the `serve` section of the shared `bytefly.json` (global
 * then project, project wins).
 *
 * `0` — the default — takes one free port for the session and remembers it, which
 * is what a session that never bookmarks wants. A positive value pins the session's
 * server, so every page it serves keeps the address a bookmark already points at.
 * A pinned port that is taken fails the start rather than moving the pages out from
 * under the bookmark.
 *
 * Pin it in the project document when more than one repository runs pages on the
 * machine: a global value is one port for every session.
 */

import { clampInteger, loadConfigSection } from "../../lib/config.ts";

/** The `serve` section. */
export interface ServeConfig {
	/** TCP port on `127.0.0.1`; `0` picks one for the session, a positive value pins it. */
	port: number;
}

export const DEFAULT_SERVE_CONFIG: ServeConfig = { port: 0 };

/** Validate and clamp a raw config object over the defaults. */
export function normalizeServeConfig(
	raw: Record<string, unknown> | undefined,
	base: ServeConfig = DEFAULT_SERVE_CONFIG,
): ServeConfig {
	if (!raw) return base;
	return { port: clampInteger(raw.port, base.port, 0, 65_535) };
}

/** Load the effective config for a working directory. */
export function loadServeConfig(cwd: string): ServeConfig {
	return loadConfigSection(cwd, "serve", DEFAULT_SERVE_CONFIG, normalizeServeConfig);
}

/**
 * The session's one port: the `serve` section of the shared `bytefly.json` (global
 * then project, project wins).
 *
 * `0` — the default — takes the project's own port: its repository key hashed into the
 * band `lib/http/port.ts` holds, so a session that starts again lands where a bookmark
 * already points and two repositories do not compete for one number. A positive value
 * pins the session's server, so every page it serves keeps the address a bookmark
 * already points at. Either way a port another process holds costs the start its
 * OS-chosen fallback — unless it was pinned, which fails the start rather than moving
 * the pages out from under the bookmark.
 *
 * Pin it in the project document when a repository needs a number of its own: a global
 * value is one port for every session.
 */

import { clampInteger, loadConfigSection } from "../../lib/config.ts";

/** The `serve` section. */
export interface ServeConfig {
	/** TCP port on `127.0.0.1`; `0` takes the project's port, a positive value pins it. */
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

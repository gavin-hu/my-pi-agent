/**
 * The board's one setting: the port its page is pinned to.
 *
 * The `board` section of the shared `bytefly.json` (global then project, project
 * wins). `0` — the default — takes one free port for the session and remembers it,
 * which is what a session that never bookmarks its URL wants; a positive value pins
 * the page, so a bookmarked URL survives a restart. A pinned port that is taken
 * fails the start rather than moving the page out from under the bookmark.
 *
 * Pin it in the project document when more than one repository runs a board: a
 * global value is one port for every board on the machine.
 */

import { clampInteger, loadConfigSection } from "../../lib/config.ts";

/** The `board` section. */
export interface BoardConfig {
	/** TCP port on `127.0.0.1`; `0` picks one for the session, a positive value pins it. */
	port: number;
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = { port: 0 };

/** Validate and clamp a raw config object over the defaults. */
export function normalizeBoardConfig(
	raw: Record<string, unknown> | undefined,
	base: BoardConfig = DEFAULT_BOARD_CONFIG,
): BoardConfig {
	if (!raw) return base;
	return { port: clampInteger(raw.port, base.port, 0, 65_535) };
}

/** Load the effective config for a working directory. */
export function loadBoardConfig(cwd: string): BoardConfig {
	return loadConfigSection(cwd, "board", DEFAULT_BOARD_CONFIG, normalizeBoardConfig);
}

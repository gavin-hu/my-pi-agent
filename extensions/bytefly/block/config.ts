/**
 * Tuning for the tool-block frame.
 *
 * A tool block is a left rail: every line of the call and of the result is
 * indented and prefixed with one rail glyph, painted by status. The rail
 * replaces Pi's filled status background, so color still means something
 * without a full-width block.
 */

import type { TuiRole } from "../../../lib/tui/tokens.ts";

/** How a tool block reads at a glance. */
export type BlockStatus = "info" | "ok" | "bad";

export const BLOCK_CONFIG = {
	/** Left rail glyph, one column, drawn on every line of the block. */
	rail: "│",
	/** Design role per status: a running call, a success, an error. */
	roles: { info: "info", ok: "ok", bad: "bad" } as Record<BlockStatus, TuiRole>,
} as const;

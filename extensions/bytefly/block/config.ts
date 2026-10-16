/**
 * Tuning for the tool-block frame.
 *
 * A tool block hangs from the shared transcript rail (`lib/tui/rail.ts`): every
 * line of the call and of the result is indented and prefixed with the rail,
 * painted by status. The glyph and the status-to-role map are that shared
 * vocabulary, so a tool block and a notice cannot drift.
 */

import { RAIL_ROLES, type RailStatus } from "../../../lib/tui/rail.ts";

/** How a tool block reads at a glance. */
export type BlockStatus = Exclude<RailStatus, "warn">;

export const BLOCK_CONFIG = {
	/** Design role per status: a running call, a success, an error. */
	roles: RAIL_ROLES,
} as const;

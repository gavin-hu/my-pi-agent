/**
 * Tuning for the tool-block frame.
 *
 * A tool block hangs from the shared transcript rail (`lib/tui/rail.ts`): every
 * line of the call and of the result is indented and prefixed with the rail,
 * painted by status. The glyph stays neutral by default, so a finished call
 * spends no colour at all and only a running or failed one stands out.
 */

import { RAIL_ROLES, type RailStatus } from "../../../lib/tui/rail.ts";
import type { TuiRole } from "../../../lib/tui/tokens.ts";

/** How a tool block reads at a glance. */
export type BlockStatus = Exclude<RailStatus, "warn">;

export const BLOCK_CONFIG = {
	/**
	 * A running call is active, so its rail takes the accent — the one colour a
	 * tool block spends. A finished call stays neutral and an error keeps the
	 * shared `bad` role, so the rail family still cannot drift.
	 */
	roles: { info: "accent", ok: RAIL_ROLES.ok, bad: RAIL_ROLES.bad } as Record<BlockStatus, TuiRole>,
} as const;

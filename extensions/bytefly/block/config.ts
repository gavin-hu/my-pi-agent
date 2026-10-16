/**
 * Tuning for the tool-block result rail.
 *
 * A tool result hangs from the transcript rail (`../chrome.ts`), painted by
 * status; the call stays plain-indented. A finished or merely informational
 * result keeps the neutral `faint` rail, so only a running or failed one spends
 * colour. The two filled tools (`edit`, `write`) skip the rail entirely and read
 * by their status fill instead.
 */

import type { TuiRole } from "../../../lib/tui/tokens.ts";
import { RAIL_ROLES, type RailStatus } from "../chrome.ts";

/** How a tool result reads at a glance; `warn` is the notice's rail. */
export type BlockStatus = Exclude<RailStatus, "warn">;

export const BLOCK_CONFIG = {
	/**
	 * A running result is active, so its rail takes the accent — the one colour a
	 * tool result spends. A finished result stays neutral and an error keeps the
	 * shared `bad` role, so the rail family still cannot drift.
	 */
	roles: { info: "accent", ok: RAIL_ROLES.ok, bad: RAIL_ROLES.bad } as Record<BlockStatus, TuiRole>,
} as const;

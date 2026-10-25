/**
 * Board's side of the team: the one call that puts this session on it.
 *
 * The user's surface is `/board` and `team`; the session bus is the transport under
 * them. So the board joins on the user's behalf — when the page opens, and again the
 * first time a card is worked — and never asks anybody to run a bus action.
 *
 * The seam exists for the same reason `team`'s dispatch does: a board suite drives a
 * recording join instead of a bus, and the shipped implementation is one in-process
 * request through `lib/session-tool.ts` (a command context cannot call a tool).
 */

import type { JoinResult } from "../../lib/session-tool.ts";
import { DEFAULT_SEAT } from "./seat.ts";

/**
 * The join itself is `lib/session-tool.ts`'s, because `team` asks for it too; this
 * module only holds what is the board's — the label it lands on, and how the outcome
 * reads on a `/board` line.
 */
export type { TeamJoin } from "../../lib/session-tool.ts";

/**
 * The label `/board` lands on: the page's seat when this session serves it, and
 * nothing when it watches somebody else's page, so a viewer keeps its own name.
 */
export function joinLabel(served: boolean): string | undefined {
	return served ? DEFAULT_SEAT : undefined;
}

/**
 * What the join did, as a clause for a `/board` line.
 *
 * A board with no bus still serves, so the failure is a clause and not an error: the
 * page works, and the line says there is no team to hand work over.
 */
export function teamLine(result: JoinResult | undefined): string {
	if (result === undefined) return "";
	if (!result.ok) return ` · no team (${result.error})`;
	const state = result.watching.armed ? "listening" : "not listening";
	return ` · on the team as ${result.label}, ${state}`;
}

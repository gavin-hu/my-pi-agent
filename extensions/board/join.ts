/**
 * The board's side of the team: how a join reads on a `/board` line.
 *
 * The user's surface is `/board` and `team`; the session bus is the transport under
 * them. So the board joins on the user's behalf — when the page opens, and the first
 * time this session claims a card — and never asks anybody to run a bus action.
 *
 * The join itself is `lib/board/join.ts`'s `joinOnce`, because a claim joins from either
 * tool; this module holds what is the board's own: what a `/board` line says about it.
 */

import type { JoinResult } from "../../lib/session-tool.ts";

export type { TeamJoin } from "../../lib/session-tool.ts";

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

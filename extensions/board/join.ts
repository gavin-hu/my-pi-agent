/**
 * The board's side of the team: how a join reads on a `/board` line.
 *
 * The user's surface is `/board` and `team`; the session bus is the transport under
 * them. So the board joins on the user's behalf — when the page opens, and the first
 * time this session claims a card — and never asks anybody to run a bus action.
 *
 * The join itself is `lib/board/join.ts`'s `joinTeam`, because a claim joins from either
 * tool and the page joins for the person, and all of them ask the same rule; this module
 * holds what is the board's own: what a `/board` line says about it.
 */

import type { TeamState } from "../../lib/board/join.ts";

export type { TeamState } from "../../lib/board/join.ts";
export type { TeamJoin } from "../../lib/session-tool.ts";

/**
 * What the team is, as a clause for a `/board` line.
 *
 * A board with no bus still serves, so the failure is a clause and not an error: the
 * page works, and the line says there is no team to hand work over. A record that does not
 * say whether mail will reach the session prints the name alone rather than accusing it.
 */
export function teamLine(state: TeamState | undefined): string {
	if (state === undefined) return "";
	if ("error" in state) return ` · no team (${state.error})`;
	if (state.listening === undefined) return ` · on the team as ${state.label}`;
	const word = state.listening ? "listening" : "not listening";
	return ` · on the team as ${state.label}, ${word}`;
}

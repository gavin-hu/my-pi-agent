/**
 * The `team` tool's parameters: two actions over one card.
 *
 * `assign` names the peer a handoff goes to, and `reclaim` takes a card back. Both
 * take the card the way `board` does — `4` or `#4` — because a lead reads ids off
 * the same board.
 */

import { Type } from "typebox";
import { TEAM_ACTIONS } from "./types.ts";

export const TeamParams = Type.Object({
	action: Type.Union(
		TEAM_ACTIONS.map((action) => Type.Literal(action)),
		{
			description:
				"`assign` hands a card to a running session and sends it a handoff; `offer` broadcasts an unclaimed card to " +
				"every other live session and writes nothing, so the first to claim it takes it; `reclaim` takes a card back " +
				"to Backlog. A lead's three actions — use `board` to create, claim, move, note, and finish the cards themselves.",
		},
	),
	card: Type.String({ description: 'The card to act on, e.g. "4" or "#4".' }),
	to: Type.Optional(
		Type.String({
			description: "`assign`: the peer to hand the card to, as `/team` lists them — a teammate's label or id.",
		}),
	),
	note: Type.Optional(Type.String({ description: "`assign` or `offer`: a line to include, e.g. what to do first." })),
});

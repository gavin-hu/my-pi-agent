/**
 * The `team` tool's parameters: three actions, two of them over one card.
 *
 * `assign` names the peer a handoff goes to and `offer` takes a card; `ask` names the peer to
 * question. The two card verbs take the card the way `board` does — `4` or `#4` — because a lead
 * reads ids off the same board, and `ask` takes none at all, which is why `card` is optional here
 * and checked per verb.
 */

import { Type } from "typebox";
import { TEAM_ACTIONS } from "./types.ts";

export const TeamParams = Type.Object({
	action: Type.Union(
		TEAM_ACTIONS.map((action) => Type.Literal(action)),
		{
			// What a parameter can say that the description cannot: the fields each verb reads. The
			// sentences were here once, and the copy drifted from the description before anything drew
			// a line between them — one surface cannot disagree with itself.
			description:
				"`assign` and `offer` take a `card`; `ask` takes `to` and no card — what each does is in the description.",
		},
	),
	card: Type.Optional(Type.String({ description: 'The card to act on, e.g. "4" or "#4"; `ask` takes none.' })),
	to: Type.Optional(
		Type.String({
			description: "`assign` or `ask`: the peer — a teammate's label or id, as `/team` lists them.",
		}),
	),
	note: Type.Optional(Type.String({ description: "`assign` or `offer`: a line to include, e.g. what to do first." })),
	question: Type.Optional(
		Type.String({
			description:
				"`ask`: what to ask, one line; defaults to asking how it is going. The ask carries its own id, and the reply opens with `re: <id>`.",
		}),
	),
});

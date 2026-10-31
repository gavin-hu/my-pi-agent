/**
 * The `team` tool's parameters: five actions, four of them over one card.
 *
 * `assign` names the peer a handoff goes to, `reclaim` takes a card back, and `claim`
 * takes one for the lead; `ask` names the peer to question. The four card verbs take the
 * card the way `board` does — `4` or `#4` — because a lead reads ids off the same board,
 * and `ask` takes none at all, which is why `card` is optional here and checked per verb.
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
				"to Backlog; `claim` takes one for the lead itself, which then plans and records it with `board`; `ask` sends " +
				"one peer a question and starts nothing, so the answer arrives as mail. They are the round's five verbs: " +
				"`board` creates, plans, moves, and finishes the cards, and the page is a view.",
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
		Type.String({ description: "`ask`: what to ask, one line; defaults to asking how it is going." }),
	),
});

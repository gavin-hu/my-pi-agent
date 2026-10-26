/**
 * The `board` tool's parameters.
 *
 * One action-shaped tool, so every field is optional except the action and each
 * action reads only its own — the description says which. `card` takes `4` or
 * `#4`; the schema stays a string because `#` is how a person writes it and the
 * boundary (`card.ts`) is where that is normalized.
 */

import { Type } from "typebox";
import { CARD_STATUSES, PRIORITIES } from "../../lib/board/card.ts";
import { BOARD_ACTIONS } from "./types.ts";

export const BoardParams = Type.Object({
	action: Type.Union(
		BOARD_ACTIONS.map((action) => Type.Literal(action)),
		{
			// The verbs and their meanings live in the tool description, built from
			// `BOARD_ACTION_DOCS`; this says only what a caller needs to choose one.
			description: "`list` reads the board; every other verb changes it. The tool description says what each one does.",
		},
	),
	card: Type.Optional(
		Type.String({ description: 'The card id for one card, e.g. "4" or "#4". Used by every action but `list`/`add`.' }),
	),
	status: Type.Optional(
		Type.Union(
			CARD_STATUSES.map((status) => Type.Literal(status)),
			{
				description:
					"`list`: show only this lane, and not skip the `done` cards. `move`: the lane to move to (not `todo` — use `release`).",
			},
		),
	),
	blockedBy: Type.Optional(
		Type.String({
			description:
				"`move` to `blocked`: what the card waits on — the decision a person has to make, one line, at most 200 characters.",
		}),
	),
	title: Type.Optional(Type.String({ description: "`add` and `edit`: the feature's outcome, one line." })),
	paths: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"`add` and `edit`: repository-relative hints (directories or files) where the work happens. Not claims.",
		}),
	),
	note: Type.Optional(Type.String({ description: "`add`: a first note, e.g. why the card exists." })),
	text: Type.Optional(Type.String({ description: "`note`: the note to append." })),
	path: Type.Optional(Type.String({ description: "`plan`: the plan file this card is executing." })),
	priority: Type.Optional(
		Type.Union(
			PRIORITIES.map((priority) => Type.Literal(priority)),
			{
				description:
					"`add` and `edit`: how urgent the feature is. `high` sorts first inside its lane; `normal` is the default.",
			},
		),
	),
	dependsOn: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"`edit`: the cards this one waits for, as ids. It cannot be claimed or moved to doing or done while one of them is unfinished; `[]` removes every link.",
		}),
	),
	mine: Type.Optional(
		Type.Boolean({ description: "`list`: show only the cards this session holds — the queue a teammate works from." }),
	),
	query: Type.Optional(
		Type.String({
			description:
				"`list`: show only the cards whose title, holder, path hint, plan, or a note's text matches this text, case-insensitively.",
		}),
	),
	round: Type.Optional(
		Type.Boolean({
			description: "`list`: also return the lead's rollup — owners, unassigned, unplanned, blocked, idle.",
		}),
	),
});

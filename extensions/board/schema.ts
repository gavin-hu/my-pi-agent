/**
 * The `board` tool's parameters.
 *
 * One action-shaped tool, so every field is optional except the action and each
 * action reads only its own — the description says which. `card` takes `4` or
 * `#4`; the schema stays a string because `#` is how a person writes it and the
 * boundary (`card.ts`) is where that is normalized.
 */

import { Type } from "typebox";
import { CARD_STATUSES } from "../../lib/board/card.ts";
import { BOARD_ACTIONS } from "./types.ts";

export const BoardParams = Type.Object({
	action: Type.Union(
		BOARD_ACTIONS.map((action) => Type.Literal(action)),
		{
			description:
				"`list` the board (optionally one card, one lane, or the lead's rollup), `add` a card, " +
				"`claim` one for this session, `release` it, `move` it to another lane, `note` it, " +
				"`plan` it (record the plan file being executed), or `drop` it.",
		},
	),
	card: Type.Optional(
		Type.String({ description: 'The card id for one card, e.g. "4" or "#4". Used by every action but `list`/`add`.' }),
	),
	status: Type.Optional(
		Type.Union(
			CARD_STATUSES.map((status) => Type.Literal(status)),
			{
				description: "`list`: show only this lane. `move`: the lane to move to (not `todo` — use `release`).",
			},
		),
	),
	title: Type.Optional(Type.String({ description: "`add`: the feature's outcome, one line." })),
	paths: Type.Optional(
		Type.Array(Type.String(), {
			description: "`add`: repository-relative hints (directories or files) where the work happens. Not claims.",
		}),
	),
	note: Type.Optional(Type.String({ description: "`add`: a first note, e.g. why the card exists." })),
	text: Type.Optional(Type.String({ description: "`note`: the note to append." })),
	path: Type.Optional(Type.String({ description: "`plan`: the plan file this card is executing." })),
	round: Type.Optional(
		Type.Boolean({
			description: "`list`: also return the lead's rollup — owners, unassigned, unplanned, blocked, idle.",
		}),
	),
});

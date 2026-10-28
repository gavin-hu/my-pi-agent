/**
 * The `board` tool's parameters.
 *
 * One action-shaped tool, so every field is optional except the action and each
 * action reads only its own — the description says which. `card` takes `4` or
 * `#4`; the schema stays a string because `#` is how a person writes it and the
 * boundary (`card.ts`) is where that is normalized.
 */

import { Type } from "typebox";
import { MAX_NOTE, PRIORITIES } from "../../lib/board/card.ts";
import { listOf } from "../../lib/format.ts";
import { BLOCKERS } from "../../lib/board/card.ts";
import { LANES, movableLanes } from "../../lib/board/lanes.ts";
import { BOARD_ACTIONS } from "./types.ts";

export const BoardParams = Type.Object({
	action: Type.Union(
		BOARD_ACTIONS.map((action) => Type.Literal(action)),
		{
			// The verbs and their meanings live in the tool description, built from
			// `BOARD_ACTION_DOCS`; this says only what a caller needs to choose one.
			description:
				"`list` reads the board, or one card when `card` names it; every other verb changes it. The tool description says what each one does.",
		},
	),
	card: Type.Optional(
		Type.String({
			description:
				'The card id for one card, e.g. "4" or "#4". `list` reads that card; every other action but `add` acts on it.',
		}),
	),
	lane: Type.Optional(
		Type.Union(
			LANES.map((lane) => Type.Literal(lane)),
			{
				// The lanes a move may name come from the transition table, so a route added
				// there is offered here without a second list to forget.
				description:
					"`list`: show only this lane, and not skip the `done` cards. " +
					`\`move\`: the lane to move to — ${listOf(movableLanes())}; \`backlog\` is \`release\`'s, not a move's, and a card may move only where a transition exists from its own lane.`,
			},
		),
	),
	blockedBy: Type.Optional(
		Type.String({
			description:
				"`move` to `blocked`: what the card waits on — the decision a person has to make, one line, at most 200 characters.",
		}),
	),
	blocker: Type.Optional(
		Type.Union(
			BLOCKERS.map((blocker) => Type.Literal(blocker)),
			{
				description:
					"`move` to `blocked`, required: why it is blocked. `contract` sends the card back to `plan`; `dependency` and `decision` resume in `execute`.",
			},
		),
	),
	title: Type.Optional(Type.String({ description: "`add` and `edit`: the feature's outcome, one line." })),
	paths: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"`add` and `edit`: repository-relative hints (directories or files) where the work happens. Not claims.",
		}),
	),
	note: Type.Optional(
		Type.String({
			description: `\`add\`: a first note, e.g. why the card exists; one line, at most ${MAX_NOTE} characters.`,
		}),
	),
	text: Type.Optional(
		Type.String({ description: `\`note\`: the note to append; one line, at most ${MAX_NOTE} characters.` }),
	),
	path: Type.Optional(Type.String({ description: "`contract`: the plan file this card is executed against." })),
	goal: Type.Optional(
		Type.String({ description: "`contract`: what the feature is for, one line, at most 400 characters." }),
	),
	acceptance: Type.Optional(
		Type.String({ description: "`contract`: how a reader can tell it is done, one line, at most 400 characters." }),
	),
	scopeOut: Type.Optional(
		Type.String({ description: "`contract`: what this deliberately does not do, one line, at most 400 characters." }),
	),
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
				"`edit`: the cards this one waits for, as ids. It cannot be claimed, or moved to execute or done, while one of them is unfinished; `[]` removes every link.",
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
	archived: Type.Optional(
		Type.Boolean({
			description:
				"`list`: read the archive instead of the board — the finished cards `archive` set aside, which no other read opens. `query` and `mine` narrow it; `lane` and `round` do not apply to a pile that is out of the board.",
		}),
	),
});

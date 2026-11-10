/**
 * The `board` tool's parameters.
 *
 * One action-shaped tool, so every field is optional except the action and each
 * action reads only its own — the description says which. `card` takes `4` or
 * `#4`; the schema stays a string because `#` is how a person writes it and the
 * boundary (`card.ts`) is where that is normalized.
 */

import type { Static } from "typebox";
import { Type } from "typebox";
import { MAX_NOTE, PRIORITIES } from "../../lib/board/card.ts";
import { CARD_TYPES } from "../../lib/board/kind.ts";
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
				'The card id for one card, e.g. "4" or "#4". `list` reads that card, and refuses `lane`, `query`, `mine`, and `round` with it; every other action but `add` acts on it.',
		}),
	),
	lane: Type.Optional(
		Type.Union(
			LANES.map((lane) => Type.Literal(lane)),
			{
				// The lanes a move may name are every lane but `backlog`: which targets exist
				// depends on the card's own lane, and a schema has no card. `steps.ts` refuses a
				// route that does not exist, and prints the targets `targetsFrom` allows.
				description:
					"`list`: only this lane, and not skip the `done` cards. " +
					`\`move\`: the lane to move to — ${listOf(movableLanes())}; \`backlog\` is \`release\`'s, and only a transition from the card's own lane is allowed.`,
			},
		),
	),
	blockedBy: Type.Optional(
		Type.String({
			description:
				"`move` to `blocked`: what it waits on — the decision a person owes, one line, at most 200 characters.",
		}),
	),
	blocker: Type.Optional(
		Type.Union(
			BLOCKERS.map((blocker) => Type.Literal(blocker)),
			{
				description:
					"`move` to `blocked`, required: why it is blocked — the errand, not the route. A blocked card resumes in `plan`, or in `execute` once its contract is approved.",
			},
		),
	),
	title: Type.Optional(Type.String({ description: "`add` and `edit`: the feature's outcome, one line." })),
	paths: Type.Optional(
		Type.Array(Type.String(), {
			description: "`add` and `edit`: repository-relative hints where the work happens. Not claims.",
		}),
	),
	note: Type.Optional(
		Type.String({
			description: `\`add\`: a first note, e.g. why the card exists; one line, ≤${MAX_NOTE} characters.`,
		}),
	),
	text: Type.Optional(
		Type.String({
			description: `\`note\`: the note to append; \`approve\` and \`review\`: what the signer saw; one line, ≤${MAX_NOTE} characters.`,
		}),
	),
	override: Type.Optional(
		Type.String({
			description: "`review`: why, for a card already `done`; the record says `closed by instruction`.",
		}),
	),
	path: Type.Optional(
		Type.String({
			description:
				"`contract`, required: the plan file this card is executed against — the path `plan` action `write` returned, inside this repository's plan store.",
		}),
	),
	goal: Type.Optional(Type.String({ description: "`contract`: what the feature is for, one line, ≤400 characters." })),
	acceptance: Type.Optional(
		Type.String({ description: "`contract`: how a reader can tell it is done, one line, ≤400 characters." }),
	),
	scopeOut: Type.Optional(
		Type.String({ description: "`contract`: what this deliberately does not do, one line, ≤400 characters." }),
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
	type: Type.Optional(
		Type.Union(
			CARD_TYPES.map((type) => Type.Literal(type)),
			{
				description: "`add` and `edit`: what the card changes about the package; absent draws nothing.",
			},
		),
	),
	breaking: Type.Optional(
		Type.Boolean({
			description: "`add` and `edit`: an existing user must change something; `false` clears it.",
		}),
	),
	dependsOn: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"`edit`: the cards this one waits for, as ids. An unfinished one refuses a claim and a move to execute or done; `[]` removes every link.",
		}),
	),
	mine: Type.Optional(Type.Boolean({ description: "`list`: only the cards this session holds." })),
	query: Type.Optional(
		Type.String({
			description: "`list`: only the cards whose title, holder, kind, path, plan, or a note matches this text.",
		}),
	),
	round: Type.Optional(
		Type.Boolean({
			description: "`list`: also print the lead's rollup over the whole board, after the listing.",
		}),
	),
	archived: Type.Optional(
		Type.Boolean({
			description:
				"`list`: read the archive instead of the board — the finished cards `archive` set aside; `query` and `mine` narrow it, and `lane` and `round` do not apply.",
		}),
	),
});

/** The parameters as the schema validates them. */
export type BoardArgs = Static<typeof BoardParams>;

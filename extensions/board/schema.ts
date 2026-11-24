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
import {
	BLOCKERS,
	MAX_BLOCKED,
	MAX_DEPENDS,
	MAX_NOTE,
	MAX_PATH,
	MAX_PATHS,
	MAX_PLAN,
	MAX_TITLE,
	PRIORITIES,
} from "../../lib/workflow/card.ts";
import { CARD_TYPES } from "../../lib/workflow/kind.ts";
import { MAX_CONTRACT } from "../../lib/workflow/contract.ts";
import { listOf } from "../../lib/format.ts";
import { StringEnum } from "../../lib/tool-schema.ts";
import { LANES, movableLanes } from "../../lib/workflow/lanes.ts";
import { BOARD_ACTIONS } from "./types.ts";

export const BoardParams = Type.Object({
	action: StringEnum(BOARD_ACTIONS, {
		// The verbs and their meanings live in the tool description, built from
		// `BOARD_ACTION_DOCS`; this says only what a caller needs to choose one.
		description: "`list` reads the board, or one card when `card` names it; every other verb changes it.",
	}),
	card: Type.Optional(
		Type.String({
			description:
				'The card id for one card, e.g. "4" or "#4". `list` reads that card, and refuses `lane`, `query`, `mine`, and `round` with it; every other action but `add` acts on it.',
		}),
	),
	lane: Type.Optional(
		StringEnum(LANES, {
			// The lanes a move may name are every lane but `backlog`: which targets exist
			// depends on the card's own lane, and a schema has no card. `steps.ts` refuses a
			// route that does not exist, and prints the targets `targetsFrom` allows.
			description:
				"`list`: only this lane, and not skip the `done` cards. " +
				`\`move\`: the lane to move to — ${listOf(movableLanes())}; \`backlog\` is \`release\`'s.`,
		}),
	),
	blockedBy: Type.Optional(
		Type.String({
			maxLength: MAX_BLOCKED,
			description: "`move` to `blocked`: what it waits on — the decision a person owes, one line.",
		}),
	),
	blocker: Type.Optional(
		StringEnum(BLOCKERS, {
			description:
				"`move` to `blocked`, required: why it is blocked — the errand, not the route. A blocked card resumes in `plan`, or in `execute` once its contract is approved.",
		}),
	),
	title: Type.Optional(
		Type.String({ maxLength: MAX_TITLE, description: "`add` and `edit`: the feature's outcome, one line." }),
	),
	paths: Type.Optional(
		Type.Array(Type.String({ maxLength: MAX_PATH }), {
			maxItems: MAX_PATHS,
			description: "`add` and `edit`: repository-relative hints where the work happens. Not claims.",
		}),
	),
	note: Type.Optional(
		Type.String({
			maxLength: MAX_NOTE,
			description:
				"`add`: a first note; `note`: the note to append; `approve` and `review`: what the signer saw; one line.",
		}),
	),
	override: Type.Optional(
		Type.String({
			maxLength: MAX_CONTRACT,
			description: "`move` to `done`: why, when no merge can be named.",
		}),
	),
	landed: Type.Optional(
		Type.String({
			maxLength: 40,
			description: "`move` to `done`: the merge the chain cannot name.",
		}),
	),
	root: Type.Optional(
		Type.String({
			description: "`review`: the card's worktree, or a checkout at its commit — not a store or plan path.",
		}),
	),
	path: Type.Optional(
		Type.String({
			maxLength: MAX_PLAN,
			description:
				"`contract`, required: the plan file this card is executed against — the path `plan` action `write` returned.",
		}),
	),
	goal: Type.Optional(
		Type.String({ maxLength: MAX_CONTRACT, description: "`contract`: what the feature is for, one line." }),
	),
	acceptance: Type.Optional(
		Type.String({
			maxLength: MAX_CONTRACT,
			description: "`contract`: how a reader can tell it is done, one line.",
		}),
	),
	verify: Type.Optional(
		Type.String({
			maxLength: MAX_CONTRACT,
			description:
				"`contract`, required: the command its acceptance is checked by — one line — which the spot-check runs and records.",
		}),
	),
	scopeOut: Type.Optional(
		Type.String({
			maxLength: MAX_CONTRACT,
			description: "`contract`: what this deliberately does not do, one line.",
		}),
	),
	priority: Type.Optional(
		StringEnum(PRIORITIES, {
			description:
				"`add` and `edit`: how urgent the feature is. `high` sorts first inside its lane; `normal` is the default.",
		}),
	),
	type: Type.Optional(
		StringEnum(CARD_TYPES, {
			description: "`add` and `edit`: what the card changes about the package; absent draws nothing.",
		}),
	),
	breaking: Type.Optional(
		Type.Boolean({
			description: "`add` and `edit`: an existing user must change something; `false` clears it.",
		}),
	),
	dependsOn: Type.Optional(
		Type.Array(Type.String(), {
			maxItems: MAX_DEPENDS,
			description:
				"`edit`: the cards this one waits for, as ids. An unfinished one refuses a claim and a move to execute or done; `[]` removes every link.",
		}),
	),
	mine: Type.Optional(Type.Boolean({ description: "`list`: only the cards this session holds." })),
	query: Type.Optional(
		Type.String({
			description: "`list`: only the cards whose id, title, holder, kind, path, plan, or note match this text.",
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
				"`list`: read the archive — the finished cards `archive` set aside; `query` and `mine` narrow it, `lane` and `round` do not.",
		}),
	),
	olderThan: Type.Optional(
		Type.String({
			description:
				"`archive`: only cards finished at least this long ago (`30d`, `12h`, `90m`, `45s`); absent sweeps all, and it takes no `card`.",
		}),
	),
});

/** The parameters as the schema validates them. */
export type BoardArgs = Static<typeof BoardParams>;

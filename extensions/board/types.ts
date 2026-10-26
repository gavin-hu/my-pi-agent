/**
 * The shapes the `board` tool registers and reports.
 *
 * `details` is the result's state: the card an action produced, the cards a list
 * read, the rollup when it was asked for, and — on a refusal — the card as it was,
 * so a retry starts from the truth rather than from what the model thought it
 * knew. The renderer and the tool share these types, and nothing else.
 */

import type { Card } from "../../lib/board/card.ts";
import type { Actor } from "../../lib/board/rules.ts";
import type { RoundSummary } from "../../lib/board/round.ts";

/** The tool's name. One extension registers it, so it stays here. */
export const BOARD_TOOL = "board";

/** The actions the tool accepts, in the order the description lists them. */
export const BOARD_ACTIONS = [
	"list",
	"add",
	"claim",
	"release",
	"reclaim",
	"move",
	"note",
	"plan",
	"edit",
	"drop",
] as const;

/** One action. */
export type BoardAction = (typeof BOARD_ACTIONS)[number];

/**
 * What each verb does, in one sentence.
 *
 * The tool description is built from this table and the parameter's `action`
 * description points at that sentence, so the verbs are stated once. A new action is
 * a row here and an entry in {@link BOARD_ACTIONS}; `test` holds the two together.
 */
export const BOARD_ACTION_DOCS: Record<BoardAction, string> = {
	list:
		"shows the board — `status` filters one lane, `mine` only what this session holds, " +
		"`query` matches a title, a holder, a path hint, the plan, or a note's text, `card` shows one card, and `round` adds " +
		"the lead's rollup of owners, unassigned, unplanned, blocked, and idle, which always covers the whole board — and a " +
		"listing that names no lane leaves out the `done` cards, saying how many it left out",
	add: "creates a `todo` card",
	claim: "takes one for this session",
	release: "gives it back",
	reclaim: "takes it from whoever holds it",
	move: "changes lane",
	note: "appends to its history",
	plan: "records the plan file being executed",
	edit: "fixes what the card says — title, path hints, priority, and what it waits for",
	drop: "deletes a `todo`, a `done`, or one you hold",
};

/**
 * The fields each action acts on: the behaviour, where {@link BOARD_ACTION_DOCS} is prose.
 *
 * The parameters are one flat object, so a field is published to every action at once;
 * that is only harmless while each action reads its own. A call carrying a field its
 * action never reads is refused against this table, because the alternative is what
 * `add` did with `dependsOn`: accepted, ignored, and reported as recorded.
 *
 * `test` holds the other direction — every parameter but `action` is claimed here — so
 * a new field cannot be published without an action that acts on it.
 */
export const ACTION_FIELDS: Record<BoardAction, readonly string[]> = {
	list: ["card", "status", "mine", "query", "round"],
	add: ["title", "paths", "priority", "note"],
	claim: ["card"],
	release: ["card"],
	reclaim: ["card"],
	move: ["card", "status", "blockedBy"],
	note: ["card", "text"],
	plan: ["card", "path"],
	edit: ["card", "title", "paths", "priority", "dependsOn"],
	drop: ["card"],
};

/**
 * The actions that change the board: everything but a read.
 *
 * One definition, read by the tool (does this call need a teammate?) and by plan
 * mode (may this call run while planning?), so "a read" cannot mean two things.
 */
export const BOARD_MUTATING_ACTIONS: ReadonlySet<BoardAction> = new Set(
	BOARD_ACTIONS.filter((action) => action !== "list"),
);

/** A result the transcript renders and the page's routes mirror. */
export interface BoardDetails {
	action: BoardAction;
	/** The serving session: the id Pi knows, and the label a card records. */
	me: Actor;
	/** The board a `list` read, in lane order. */
	cards?: Card[];
	/** The card an action produced, or the one a refusal left untouched. */
	card?: Card;
	/** The lead's rollup, only for `list` with `round`. */
	round?: RoundSummary;
	/** The id a `drop` removed. */
	dropped?: string;
	/** A refusal's reason, which the renderer draws instead of the details. */
	error?: string;
}

/** Whether a value is one of the actions, so an unknown one is a refusal and not a crash. */
export function normalizeBoardAction(raw: unknown): BoardAction | undefined {
	return typeof raw === "string" && BOARD_ACTIONS.includes(raw as BoardAction) ? (raw as BoardAction) : undefined;
}

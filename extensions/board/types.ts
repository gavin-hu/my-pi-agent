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
import { BOARD_ACTIONS, type BoardAction } from "../../lib/board/actions.ts";

/** The tool's name. One extension registers it, so it stays here. */
export const BOARD_TOOL = "board";

// The actions are the board's, not the tool's: plan mode's read-only policy and the todo
// nudge classify a call by the same table, and nothing under `lib/` may import this
// file. Re-exported here so the schema, the description, and the suites keep one import
// for the tool's own vocabulary.
export { BOARD_ACTIONS, type BoardAction };

/**
 * What each action does, in one sentence.
 *
 * The tool description is built from this table and the parameter's `action`
 * description points at that sentence, so the actions are stated once. A new action is
 * a row here and an entry in {@link BOARD_ACTIONS}; `test` holds the two together.
 */
export const BOARD_ACTION_DOCS: Record<BoardAction, string> = {
	list:
		"shows the board — `lane` filters one lane, `mine` only what this session holds, " +
		"`query` matches a title, a holder, a path hint, the plan, or a note's text, `card` reads that one card " +
		"instead of the board, and `round` adds the lead's rollup of owners, unassigned, unplanned, awaiting approval, " +
		"blocked, idle, and done, which always covers the whole board — and a listing that names no lane leaves out the `done` cards, " +
		"saying how many it left out",
	add: "creates a `backlog` card",
	claim: "pulls one into `plan` for this session, when `plan` has room",
	release: "gives it back to `backlog`",
	reclaim: "takes it from whoever holds it, back to `backlog`",
	move: "changes lane, through the one transition the board allows from where the card is; a card enters `execute` or `done` only while the plan it recorded is still in the store",
	note: "appends to its history",
	contract:
		"records the plan file and the three lines a card promises — `goal`, `acceptance`, `scopeOut` — and drops any approval, because the wording changed; `path` is required and must be the plan `write_plan` saved in this repository's plan store",
	approve:
		"approves the contract: a session that does not hold the card says the wording is right, which is what `plan` to `execute` requires",
	review:
		"records a spot-check of the finished work: a session that does not hold the card, in `execute`, which is what `done` requires",
	edit: "fixes what the card says — title, path hints, priority, and what it waits for",
	archive:
		"sets a finished card aside, out of the board and still readable, or every finished card when no `card` is named",
	drop: "deletes a `backlog` or a `done` card, or one you hold",
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
	list: ["card", "lane", "mine", "query", "round", "archived"],
	add: ["title", "paths", "priority", "note"],
	claim: ["card"],
	release: ["card"],
	reclaim: ["card"],
	move: ["card", "lane", "blockedBy", "blocker"],
	note: ["card", "text"],
	contract: ["card", "path", "goal", "acceptance", "scopeOut"],
	approve: ["card"],
	review: ["card"],
	edit: ["card", "title", "paths", "priority", "dependsOn"],
	archive: ["card"],
	drop: ["card"],
};

/** A result the transcript renders and the page's routes mirror. */
export interface BoardDetails {
	action: BoardAction;
	/** The serving session: the id Pi knows, and the label a card records. */
	me: Actor;
	/**
	 * Whether the read was narrowed to this session's own cards.
	 *
	 * Kept because the transcript says so: a listing that answers "what am I holding" draws
	 * those rows in the accent, and a listing that answers "what is on the board" does not
	 * pretend every row is the reader's.
	 */
	mine?: boolean;
	/** The board a `list` read, in lane order. */
	cards?: Card[];
	/** The card an action produced, or the one a refusal left untouched. */
	card?: Card;
	/** The lead's rollup, only for `list` with `round`. */
	round?: RoundSummary;
	/** The id a `drop` removed. */
	dropped?: string;
	/** The ids an `archive` set aside, in the order it moved them. */
	archived?: string[];
	/** Cards an `archive` sweep could not set aside, and why: a move that changed underneath it. */
	failed?: Array<{ card: string; error: string }>;
	/** A refusal's reason, which the renderer draws instead of the details. */
	error?: string;
}

/** Whether a value is one of the actions, so an unknown one is a refusal and not a crash. */
export function normalizeBoardAction(raw: unknown): BoardAction | undefined {
	return typeof raw === "string" && BOARD_ACTIONS.includes(raw as BoardAction) ? (raw as BoardAction) : undefined;
}

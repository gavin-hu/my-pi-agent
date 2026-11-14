/**
 * The shapes the `board` tool registers and reports.
 *
 * `details` is the result's state: the card an action produced, the cards a list
 * read, the rollup when it was asked for, what an archive did, the sentence a sign's
 * message produced, and — on a refusal — the card as it was,
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
		"shows the board — `lane` filters one lane, `mine` only what this session holds, `card` reads that one card " +
		"instead of the board, and `round` also prints the lead's rollup over the whole board: owners, unassigned, " +
		"unplanned, awaiting approval, awaiting review, blocked, unwritten, done, archivable — and a listing that " +
		"names no lane leaves out the `done` cards, saying how many it left out",
	add: "creates a `backlog` card",
	claim: "pulls one into `plan` for this session, when `plan` has room",
	release: "gives it back to `backlog`",
	reclaim: "takes it back to `backlog`; a peer only from a stopped owner",
	move: "changes lane, through the one transition the board allows from where the card is; a card enters `execute` or `done` only while the plan it recorded is still in the store",
	note: "appends to its history",
	contract:
		"records the plan file and the four lines a card promises — `goal`, `acceptance`, `scopeOut`, and `verify`, the command the spot-check runs — and drops any approval, because the wording changed",
	approve:
		"approves the contract and the plan it names: the lead, who does not hold the card, says both are right, which is what `plan` to `execute` requires, and `text` records what the signer saw",
	review:
		"records a spot-check of the finished work: the lead, who does not hold the card, in `execute`, which is what `done` requires, and `text` records what the signer saw; the sign is announced to the card's owner in its inbox, so a session that needs one asks the lead with `session send`. `override` instead signs a finished card nobody signed",
	edit: "fixes what the card says — title, path hints, type, breaking, priority, and what it waits for",
	archive:
		"sets a finished card aside, still readable — never one an open card waits on; every one if none is named, and `olderThan` bounds it by age",
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
	add: ["title", "paths", "type", "breaking", "priority", "note"],
	claim: ["card"],
	release: ["card"],
	reclaim: ["card"],
	move: ["card", "lane", "blockedBy", "blocker"],
	note: ["card", "text"],
	contract: ["card", "path", "goal", "acceptance", "scopeOut", "verify"],
	approve: ["card", "text"],
	review: ["card", "text", "override"],
	edit: ["card", "title", "paths", "type", "breaking", "priority", "dependsOn"],
	archive: ["card", "olderThan"],
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
	/** The board a `list` read, in lane order: the slice its filters asked for. */
	cards?: Card[];
	/**
	 * Whether a filter made that read a slice rather than the board.
	 *
	 * Kept because the rows say so: a slice is drawn above the rollup that covers it, and a
	 * read that asked for the board draws no listing beside one.
	 */
	narrowed?: boolean;
	/** The card an action produced, or the one a refusal left untouched. */
	card?: Card;
	/** The lead's rollup, only for `list` with `round`. */
	round?: RoundSummary;
	/** The id a `drop` removed. */
	dropped?: string;
	/** What an `archive` did, card by card: the outcome the collapsed line states. */
	archive?: ArchiveOutcome;
	/**
	 * What a sign's message to the card's owner produced: `told api-core`, that sentence with the
	 * peer's watch in it, or the one saying it was not told. Absent when nothing was sent — no
	 * owner, or a sign that wrote no fresh stamp.
	 */
	told?: string;
	/**
	 * What the bus's path claims did as this write crossed a lane — `claimed 2 paths`, a path
	 * another session holds, or the sentence saying the claim could not be made. Absent when the
	 * write stayed in its lane, the card names no paths, or no bus is loaded.
	 */
	held?: string;
	/** A refusal's reason, which the renderer draws instead of the details. */
	error?: string;
}

/**
 * What an `archive` did, in every answer a call can give.
 *
 * One shape for the single card and the sweep, because they are the same question asked
 * over one card or the board: a result that stated its own outcome in the text and
 * nothing in the details drew a listing count instead, and a sweep that failed on a card
 * read as if it had not. It is also the sweep's own return shape, so the sentence a model
 * reads and the line a reader sees are drawn from one record rather than two.
 */
export interface ArchiveOutcome {
	/** The ids it set aside, in the order it moved them. */
	moved: string[];
	/** Finished cards a live link kept on the board: an open card still waits on them. */
	kept: string[];
	/** Finished cards a bound left on the board, because they finished more recently than it. */
	held: string[];
	/** The bound as it was written, so `held` can be read against it; absent from a sweep of everything. */
	bound?: string;
	/** The cards it could not set aside, and why: a move that changed underneath it. */
	failed: Array<{ card: string; error: string }>;
	/** The one card a repeated call found already aside: a no-op, not a failure. */
	already?: string;
}

/** Whether a value is one of the actions, so an unknown one is a refusal and not a crash. */
export function normalizeBoardAction(raw: unknown): BoardAction | undefined {
	return typeof raw === "string" && BOARD_ACTIONS.includes(raw as BoardAction) ? (raw as BoardAction) : undefined;
}

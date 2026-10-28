/**
 * The board's verbs and which of them only read it.
 *
 * The list and the classification are one table because they were once two: the tool
 * registered the actions, and `lib/` compared a call's action to a bare string, so
 * nothing could prove the two agreed — a second read verb would have been refused by
 * plan mode and counted as work by the todo nudge, with every suite green.
 *
 * `BOARD_ACTION_KIND` is a `Record<BoardAction, …>`, so a verb added to
 * {@link BOARD_ACTIONS} does not compile until somebody says whether it reads. That is
 * the whole point: the answer is a type error, not a comment.
 */

/** The actions the tool accepts, in the order the description lists them. */
export const BOARD_ACTIONS = [
	"list",
	"add",
	"claim",
	"release",
	"reclaim",
	"move",
	"note",
	"contract",
	"approve",
	"review",
	"edit",
	"archive",
	"drop",
] as const;

/** One action. */
export type BoardAction = (typeof BOARD_ACTIONS)[number];

/** Whether an action reads the board or writes it. */
export type BoardActionKind = "read" | "write";

/**
 * What each verb does to the board.
 *
 * Exhaustive on purpose: a new verb is a compile error here before it can be an
 * unnoticed assumption in the read-only policy.
 */
export const BOARD_ACTION_KIND: Record<BoardAction, BoardActionKind> = {
	list: "read",
	add: "write",
	claim: "write",
	release: "write",
	reclaim: "write",
	move: "write",
	note: "write",
	contract: "write",
	approve: "write",
	review: "write",
	edit: "write",
	archive: "write",
	drop: "write",
};

/**
 * The verbs that only read, in the tool's own order.
 *
 * Plan mode names them in its refusal, so the sentence a model reads is built from the
 * table rather than from a second list of what counts as reading.
 */
export const BOARD_READ_ACTIONS: readonly BoardAction[] = BOARD_ACTIONS.filter(
	(action) => BOARD_ACTION_KIND[action] === "read",
);

/**
 * Whether a value is a board action that only reads.
 *
 * A call's `action` is whatever the model sent, so an unknown string is not a read:
 * the answer has to be safe before the tool has normalized the argument.
 */
export function isBoardReadAction(raw: unknown): boolean {
	if (typeof raw !== "string") return false;
	if (!BOARD_ACTIONS.includes(raw as BoardAction)) return false;
	return BOARD_ACTION_KIND[raw as BoardAction] === "read";
}

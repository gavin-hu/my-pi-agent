/**
 * The board's actions and which of them only read it.
 *
 * The list and the classification are one table because they were once two: the tool
 * registered the actions, and `lib/` compared a call's action to a bare string, so
 * nothing could prove the two agreed — a second read action would have been refused by
 * plan mode and counted as work by the todo nudge, with every suite green.
 *
 * `BOARD_ACTION_KIND` is a `Record<BoardAction, …>`, so an action added to
 * {@link BOARD_ACTIONS} does not compile until somebody says whether it reads. That is
 * the whole point: the answer is a type error, not a comment.
 *
 * The refusal that names the reads is built here too, beside the table it derives from,
 * for the same reason `limits.ts` keeps `wipRefusal` beside its limit: a sentence a model
 * reads is the table said aloud, and a sentence written where it is printed is a second
 * copy of the answer.
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
 * What each action does to the board.
 *
 * Exhaustive on purpose: a new action is a compile error here before it can be an
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
 * The actions that only read, in the tool's own order.
 *
 * Plan mode names them in its refusal, so the sentence a model reads is built from the
 * table rather than from a second list of what counts as reading.
 */
export const BOARD_READ_ACTIONS: readonly BoardAction[] = BOARD_ACTIONS.filter(
	(action) => BOARD_ACTION_KIND[action] === "read",
);

/**
 * The reads as one phrase — `` `list` reads ``, or `` `list` or `archive` read `` — for the
 * refusal that tells a model which action it may still use.
 *
 * The list is a parameter so both branches are testable: today exactly one action reads, so
 * a sentence that inflected off the exported table could only ever ship its singular half
 * tested. The phrase stays "or", not a comma list, because the reads are expected to stay
 * few — one is the common case, and a second is a deliberate change to the policy.
 */
export function readActionsText(actions: readonly BoardAction[] = BOARD_READ_ACTIONS): string {
	const named = actions.map((action) => `\`${action}\``).join(" or ");
	return `${named} ${actions.length === 1 ? "reads" : "read"}`;
}

/**
 * The refusal a board write meets while plan mode is on.
 *
 * Plan mode owns the rule and supplies its own exit guidance; the sentence is here because
 * it is {@link readActionsText}'s sentence, and because the order it names is the board's:
 * a claim comes before planning, and the plan is recorded once it is approved. Written once
 * so the refusal and the docs cannot teach two different orders.
 */
export function boardWriteRefusal(rawAction: unknown, guidance: string): string {
	const verb = typeof rawAction === "string" && rawAction.trim() !== "" ? rawAction.trim() : "board";
	return `Plan mode: \`${verb}\` changes the board — only ${readActionsText()} it; claim the card before you plan, and record its plan once the plan is approved. ${guidance}`;
}

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

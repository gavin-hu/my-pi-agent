/**
 * What a session is told about the cards it holds, once, before its first turn.
 *
 * The failure this answers is a session that resumes mid-card and does the work without ever
 * reading the board: the lane is the record, and a model that has not been told which lane its
 * card is in will work in the wrong one. So the first turn carries one small message — the
 * cards this session holds, and what each owes next — and nothing after it, because every
 * later turn already has the claim, the move, or the sign in its own transcript.
 *
 * The sentences come from `lib/board/reason.ts`, the page's own "what happens next" rule, so
 * the line a session reads and the line a lead reads on a card face cannot disagree. The cap
 * is a context budget, not a screen: three cards and one "more" line, which
 * `test/prompt-budget.test.ts` holds.
 *
 * Injection is `display: false`, the way `goal` restates its objective: the transcript stays
 * the work, and this is the state the work is in. The `context` handler keeps the newest copy
 * so a `/resume` cannot stack them.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Card, cardRef, holds } from "../../lib/board/card.ts";
import { laneIndex } from "../../lib/board/lanes.ts";
import { reasonFor } from "../../lib/board/reason.ts";
import { plural } from "../../lib/board/round-text.ts";
import type { BoardSession } from "../../lib/board/session.ts";

/** The marker the model reads, and the custom type the session stores. */
export const BOARD_CONTEXT_MARKER = "[BOARD]";
export const BOARD_CONTEXT_TYPE = "board-context";

/** How many held cards the line names before it counts the rest. */
export const MAX_CONTEXT_CARDS = 3;

/** The whole message's ceiling, in characters. */
export const MAX_CONTEXT_CHARS = 320;

/** The longest one bullet may be: a `blocked` note is up to 200 characters, and one card should not spend the line. */
export const MAX_BULLET_CHARS = 200;

/** Room kept for the `and N more` line, so a bullet never pushes it past the ceiling. */
const MORE_RESERVE = "\n- and 99 more".length;

/** The cards this session holds and has not finished, in lane order and then by id. */
export async function heldCards(
	session: Pick<BoardSession, "store" | "who">,
	ctx: ExtensionContext,
): Promise<Card[] | undefined> {
	try {
		const me = await session.who(ctx, ctx.cwd);
		const store = await session.store(ctx.cwd);
		const { cards } = await store.scan();
		return cards
			.filter((card) => card.lane !== "done" && holds(card, me))
			.sort((left, right) => laneIndex(left.lane) - laneIndex(right.lane) || Number(left.id) - Number(right.id));
	} catch {
		// A board that cannot be read is not a reason to fail the turn it was read for.
		return undefined;
	}
}

/**
 * The line, or `undefined` when this session holds nothing.
 *
 * Nothing is the ordinary answer, and the one that keeps the message out of every session
 * that never touches the board: a line saying "you hold no cards" would be noise in a turn
 * that has nothing to do with the board.
 */
/**
 * The line, or `undefined` when this session holds nothing.
 *
 * Nothing is the ordinary answer, and the one that keeps the message out of every session
 * that never touches the board: a line saying "you hold no cards" would be noise in a turn
 * that has nothing to do with the board.
 *
 * The budget is spent on whole bullets rather than on a slice: a card whose block note is long
 * is clipped with an ellipsis, and the cards that no longer fit are counted instead of being
 * cut off mid-sentence by the message's ceiling.
 */
export function buildBoardContext(held: readonly Card[]): string | undefined {
	if (held.length === 0) return undefined;
	const lines = [`${BOARD_CONTEXT_MARKER} ${plural(held.length, "card")} ${held.length === 1 ? "is" : "are"} yours:`];
	let shown = 0;
	for (const card of held.slice(0, MAX_CONTEXT_CARDS)) {
		const bullet = bulletOf(card);
		const rest = held.length - shown - 1;
		const fits = lines.join("\n").length + bullet.length + 1 + (rest > 0 ? MORE_RESERVE : 0) <= MAX_CONTEXT_CHARS;
		if (!fits) break;
		lines.push(bullet);
		shown += 1;
	}
	if (held.length > shown) lines.push(`- and ${held.length - shown} more`);
	return lines.join("\n");
}

/** One card's bullet, clipped to {@link MAX_BULLET_CHARS} so a long reason cannot crowd the rest out. */
function bulletOf(card: Card): string {
	// No age is read for the lanes this names: `plan`, `execute` and `blocked` all answer without
	// one, and the formatter is the parameter `reason.ts` asks for.
	const reason = reasonFor(card, () => "now");
	const line = `- ${cardRef(card.id)} (${card.lane})${reason === undefined ? "" : ` ${reason.text}`}`;
	return line.length > MAX_BULLET_CHARS ? `${line.slice(0, MAX_BULLET_CHARS - 1)}…` : line;
}

/** Whether a stored message is the line this module injected. */
export function isBoardContext(value: unknown): boolean {
	return (
		typeof value === "object" && value !== null && (value as { customType?: unknown }).customType === BOARD_CONTEXT_TYPE
	);
}

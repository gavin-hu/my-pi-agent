/**
 * The model-facing text for one card or one listing.
 *
 * Text is the model's channel, so it carries the facts a next decision needs — the
 * id, the lane, who holds it, whether it is planned, how urgent it is, and what it
 * waits for — and the renderer carries the styling. Ages and sizes stay out: a note is
 * read for what it says, and the page is where "3m ago" belongs.
 *
 * `board` is optional because a single card's answer sometimes comes without the rest
 * of the board: the ids are still named, and only the lane of each dependency is lost.
 * The rollup's text is `lib/board/round-text.ts`, because `team` prints it too.
 */

import { type Card, cardRef, DEFAULT_PRIORITY, dependsOf, priorityOf } from "../../lib/board/card.ts";
import type { BoardIndex } from "../../lib/board/links.ts";
import { plural } from "../../lib/board/round-text.ts";

/** One card: the headline, then the state a reader needs in order to act on it. */
export function formatCard(card: Card, board?: BoardIndex): string {
	return [`${cardRef(card.id)} ${card.status} · ${card.title}`, ...detailLines(card, board)].join("\n");
}

/** A board, in lane order. */
export function formatCards(cards: readonly Card[]): string {
	if (cards.length === 0) return "The board is empty.";
	return cards.map((card) => listLine(card)).join("\n");
}

/** The dropped id, which is the only thing left of the card. */
export function formatDropped(id: string): string {
	return `${cardRef(id)} dropped, with its notes.`;
}

/** A one-line listing: the id, the lane, the title, and who holds it. */
function listLine(card: Card): string {
	const holder = card.owner === undefined ? "unassigned" : card.owner.label;
	const urgency = priorityOf(card) === DEFAULT_PRIORITY ? "" : ` · ${priorityOf(card)}`;
	const waits = dependsOf(card).length === 0 ? "" : ` · waits on ${dependsOf(card).map(cardRef).join(", ")}`;
	return `${cardRef(card.id)} ${card.status} · ${card.title} · ${holder}${urgency}${waits}`;
}

/** The state lines under a card's headline. */
function detailLines(card: Card, board?: BoardIndex): string[] {
	const lines: string[] = [];
	if (card.owner !== undefined) lines.push(`  owner: ${card.owner.label}`);
	if (priorityOf(card) !== DEFAULT_PRIORITY) lines.push(`  priority: ${priorityOf(card)}`);
	if (card.plan !== undefined) lines.push(`  plan: ${card.plan}`);
	if (card.paths.length > 0) lines.push(`  paths: ${card.paths.join(", ")}`);
	if (dependsOf(card).length > 0) lines.push(`  waits on: ${waitingOf(card, board)}`);
	if (card.notes.length > 0) {
		const last = card.notes.at(-1);
		if (last) lines.push(`  last note (${last.by}): ${last.text}`);
	}
	const dropped = card.notesDropped > 0 ? ` (${card.notesDropped} earlier dropped)` : "";
	lines.push(`  ${plural(card.notes.length, "note")}${dropped}`);
	return lines;
}

/**
 * The cards a card waits on, each with its lane when the board is there to say it.
 *
 * The lane is what turns a list of ids into a decision: `#2 (done)` is a card about to
 * start, and `#2 (doing)` is one to leave alone.
 */
function waitingOf(card: Card, board: BoardIndex | undefined): string {
	return dependsOf(card)
		.map((id) => {
			const blocker = board?.get(id);
			return blocker === undefined ? cardRef(id) : `${cardRef(id)} (${blocker.status})`;
		})
		.join(", ");
}

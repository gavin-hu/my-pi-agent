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
import { type BoardIndex, lanesText, openDependentsOf } from "../../lib/board/links.ts";
import type { Skip } from "../../lib/board/store.ts";
import { formatAge } from "../../lib/format.ts";
import { plural } from "../../lib/board/round-text.ts";

/** One card: the headline, then the state a reader needs in order to act on it. */
export function formatCard(card: Card, board?: BoardIndex, now?: number): string {
	return [`${cardRef(card.id)} ${card.status} · ${card.title}`, ...detailLines(card, board, now)].join("\n");
}

/**
 * A board's listing: the cards, then the two things a reader cannot see.
 *
 * One body, because the footnotes belong to the listing: a card file this build cannot
 * read, and the finished cards a plain listing left out.
 */
export function formatBoard(shown: readonly Card[], hiddenDone: number, skipped: readonly Skip[]): string {
	const lines =
		shown.length === 0 ? [hiddenDone === 0 ? "The board is empty." : "No open cards."] : shown.map(listLine);
	// A finished card is history rather than work, so a listing that names no lane leaves
	// them out; the count is what keeps the omission from reading as a smaller board.
	if (hiddenDone > 0) {
		const them = hiddenDone === 1 ? "it" : "them";
		lines.push(`${plural(hiddenDone, "done card")} hidden; pass status: "done" to read ${them}.`);
	}
	const unreadable = formatSkipped(skipped);
	if (unreadable !== "") lines.push(unreadable);
	return lines.join("\n");
}

/**
 * The files the board could not read, or nothing when it read everything.
 *
 * A skipped file is not an absent one: a board written by a newer build would
 * otherwise read as "nobody has planned anything" while the work sits on disk.
 */
export function formatSkipped(skipped: readonly Skip[]): string {
	if (skipped.length === 0) return "";
	const files = skipped.map((entry) => `${entry.file} (${entry.why})`).join(", ");
	return `${plural(skipped.length, "file")} this build cannot read: ${files}`;
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
	// The two lanes that carry a fact of their own say it here: what a block waits on, and
	// what closed a finished card. Both are one short phrase, so a listing stays one line.
	const blocked = card.blockedBy === undefined ? "" : ` · blocked: ${card.blockedBy}`;
	const landed = card.landed === undefined ? "" : ` · landed ${card.landed.commit}`;
	return `${cardRef(card.id)} ${card.status} · ${card.title} · ${holder}${urgency}${waits}${blocked}${landed}`;
}

/** The state lines under a card's headline. */
function detailLines(card: Card, board?: BoardIndex, now?: number): string[] {
	const lines: string[] = [];
	if (card.owner !== undefined) lines.push(`  owner: ${card.owner.label}`);
	// An offer's age is the fact a reader acts on, which is the one place an age belongs in
	// this text: the value is whether anybody has had time to answer.
	if (card.offeredAt !== undefined && now !== undefined) {
		lines.push(`  offered: ${formatAge(now, card.offeredAt)} ago, and nobody took it`);
	}
	if (card.blockedBy !== undefined) lines.push(`  blocked: ${card.blockedBy}`);
	if (card.landed !== undefined) lines.push(`  landed: ${card.landed.commit}`);
	if (priorityOf(card) !== DEFAULT_PRIORITY) lines.push(`  priority: ${priorityOf(card)}`);
	if (card.plan !== undefined) lines.push(`  plan: ${card.plan}`);
	if (card.paths.length > 0) lines.push(`  paths: ${card.paths.join(", ")}`);
	if (dependsOf(card).length > 0) lines.push(`  waits on: ${waitingOf(card, board)}`);
	// The mirror question, for the same board: what leaving this card undone holds up. Only
	// a card with the board in hand can answer it, which is why a bare card read omits it.
	if (board !== undefined) {
		const dependents = openDependentsOf(card.id, board);
		if (dependents.length > 0) {
			const which = dependents.length === 1 ? "card" : "cards";
			lines.push(`  waited on by ${dependents.length} ${which}: ${lanesText(dependents)}`);
		}
	}
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

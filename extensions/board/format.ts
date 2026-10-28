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

import { type Card, type CardBlock, cardRef, DEFAULT_PRIORITY, dependsOf, priorityOf } from "../../lib/board/card.ts";
import { type BoardIndex, lanesText, openDependentsOf } from "../../lib/board/links.ts";
import type { Skip } from "../../lib/board/store.ts";
import { formatAge } from "../../lib/format.ts";
import { plural } from "../../lib/board/round-text.ts";

/** One card: the headline, then the state a reader needs in order to act on it. */
export function formatCard(card: Card, board?: BoardIndex, now?: number): string {
	return [`${cardRef(card.id)} ${card.lane} · ${card.title}`, ...detailLines(card, board, now)].join("\n");
}

/**
 * What a listing cannot show, and therefore has to say.
 *
 * A footnote is the difference between a listing and the board: an omission nobody
 * accounted for reads as a smaller board — or as history that was deleted.
 */
export interface ListingNotes {
	/** Finished cards the board holds that a lane-less listing left out. */
	hiddenDone: number;
	/** Cards set aside in the archive, which no board read opens. */
	archived: number;
	/** Card files this build could not read. */
	skipped: readonly Skip[];
}

/**
 * A board's listing: the cards, then the footnotes a reader cannot see.
 *
 * One body, because the footnotes belong to the listing: a card file this build cannot
 * read, the finished cards a plain listing left out, and the cards an `archive` set aside.
 */
export function formatBoard(shown: readonly Card[], notes: ListingNotes): string {
	const lines =
		shown.length === 0 ? [notes.hiddenDone === 0 ? "The board is empty." : "No open cards."] : shown.map(listLine);
	// A finished card is history rather than work, so a listing that names no lane leaves
	// them out; the count is what keeps the omission from reading as a smaller board.
	if (notes.hiddenDone > 0) {
		const them = notes.hiddenDone === 1 ? "it" : "them";
		lines.push(`${plural(notes.hiddenDone, "done card")} hidden; pass lane: "done" to read ${them}.`);
	}
	for (const note of [archiveNote(notes.archived), formatSkipped(notes.skipped)]) {
		if (note !== "") lines.push(note);
	}
	return lines.join("\n");
}

/**
 * The archive's listing: what is set aside, and the files there this build refused.
 *
 * The archive is read on request only, so this has no lane footnote of its own — every
 * card in the pile is finished, and a `done` lane would be a second way to say it.
 */
export function formatArchive(shown: readonly Card[], skipped: readonly Skip[]): string {
	const lines = shown.length === 0 ? ["The archive is empty."] : shown.map(listLine);
	const unreadable = formatSkipped(skipped);
	if (unreadable !== "") lines.push(unreadable);
	return lines.join("\n");
}

/**
 * The one sentence a board listing adds so its archive is not mistaken for deleted history.
 *
 * Empty when nothing is set aside, so the ordinary board says nothing new.
 */
export function archiveNote(count: number): string {
	if (count === 0) return "";
	return `${plural(count, "card")} ${count === 1 ? "is" : "are"} set aside in the archive; pass archived: true to read ${count === 1 ? "it" : "them"}.`;
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

/**
 * The ids an archive set aside, and how to read them again.
 *
 * A move has to name the way back or it reads like a deletion: the card is out of the
 * board and its notes, plan, and landed commit are still in its file.
 */
export function formatArchived(ids: readonly string[]): string {
	const theirs = ids.length === 1 ? "its" : "their";
	return `${plural(ids.length, "card")} archived: ${ids.map(cardRef).join(", ")} — out of the board, ${theirs} notes and plan still readable with archived: true.`;
}

/** A block as one line: the sentence, and the kind beside it when one was recorded. */
function blockText(block: CardBlock): string {
	const note = block.note ?? "nothing recorded";
	return block.kind === undefined ? note : `${note} (${block.kind})`;
}

/** A one-line listing: the id, the lane, the title, and who holds it. */
function listLine(card: Card): string {
	const holder = card.owner === undefined ? "unassigned" : card.owner.label;
	const urgency = priorityOf(card) === DEFAULT_PRIORITY ? "" : ` · ${priorityOf(card)}`;
	const waits = dependsOf(card).length === 0 ? "" : ` · waits on ${dependsOf(card).map(cardRef).join(", ")}`;
	// The two lanes that carry a fact of their own say it here: what a block waits on, and
	// what closed a finished card. Both are one short phrase, so a listing stays one line.
	const blocked = card.blocked === undefined ? "" : ` · blocked: ${blockText(card.blocked)}`;
	const landed = card.landed === undefined ? "" : ` · landed ${card.landed.commit}`;
	return `${cardRef(card.id)} ${card.lane} · ${card.title} · ${holder}${urgency}${waits}${blocked}${landed}`;
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
	if (card.blocked !== undefined) lines.push(`  blocked: ${blockText(card.blocked)}`);
	if (card.landed !== undefined) lines.push(`  landed: ${card.landed.commit}`);
	if (priorityOf(card) !== DEFAULT_PRIORITY) lines.push(`  priority: ${priorityOf(card)}`);
	if (card.planPath !== undefined) lines.push(`  plan: ${card.planPath}`);
	// The contract is what a reader is asked to agree to, so the block says it in full and
	// says who signed it: an approval is a fact about that wording, and a review about the
	// work, and neither is inferable from the lane.
	if (card.contract !== undefined) {
		lines.push(`  goal: ${card.contract.goal}`);
		lines.push(`  acceptance: ${card.contract.acceptance}`);
		lines.push(`  scope out: ${card.contract.scopeOut}`);
		const approved = card.contract.approved;
		lines.push(`  approved: ${approved === undefined ? "nobody yet" : approved.by}`);
	}
	if (card.review !== undefined) lines.push(`  reviewed: ${card.review.by}`);

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
 * start, and `#2 (execute)` is one to leave alone.
 */
function waitingOf(card: Card, board: BoardIndex | undefined): string {
	return dependsOf(card)
		.map((id) => {
			const blocker = board?.get(id);
			return blocker === undefined ? cardRef(id) : `${cardRef(id)} (${blocker.lane})`;
		})
		.join(", ");
}

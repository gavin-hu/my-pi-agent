/**
 * The model-facing text for one board call.
 *
 * Text is the model's channel, so it carries the facts a next decision needs — the
 * id, the lane, who holds it, whether it is planned — and the renderer carries the
 * styling. Ages and sizes stay out: a note is read for what it says, and the page
 * is where "3m ago" belongs.
 */

import { type Card, cardRef } from "../../lib/board/card.ts";
import type { RoundSummary } from "../../lib/board/round.ts";

/** One card: the headline, then the state a reader needs in order to act on it. */
export function formatCard(card: Card): string {
	return [`${cardRef(card.id)} ${card.status} · ${card.title}`, ...detailLines(card)].join("\n");
}

/** A board, in lane order. */
export function formatCards(cards: readonly Card[]): string {
	if (cards.length === 0) return "The board is empty.";
	return cards.map((card) => listLine(card)).join("\n");
}

/**
 * The lead's rollup.
 *
 * The headline counts what a lead decides on, then one line per group with the
 * cards in it. A group's cards are named by id and state, because the ids are what
 * the next action takes.
 */
export function formatRound(cards: readonly Card[], round: RoundSummary): string {
	const owners = round.owners.length;
	const headline = [
		plural(owners, "owner"),
		plural(cards.length, "feature"),
		`${round.unassigned.length} unassigned`,
		`${round.unplanned.length} unplanned`,
		`${round.blocked.length} blocked`,
		`${round.idle.length} idle`,
		`${round.done.length} done`,
	].join(" · ");
	const lines = [headline];
	for (const group of round.owners) {
		lines.push(`${group.label} (${group.cards.length}): ${group.cards.map((card) => brief(card)).join(", ")}`);
	}
	lines.push(...group("unassigned", round.unassigned));
	lines.push(...group("unplanned", round.unplanned));
	lines.push(...group("blocked", round.blocked, true));
	lines.push(...group("idle", round.idle));
	lines.push(...group("done", round.done));
	return lines.join("\n");
}

/** The dropped id, which is the only thing left of the card. */
export function formatDropped(id: string): string {
	return `${cardRef(id)} dropped, with its notes.`;
}

/** A one-line listing: the id, the lane, the title, and who holds it. */
function listLine(card: Card): string {
	const holder = card.owner === undefined ? "unassigned" : card.owner.label;
	return `${cardRef(card.id)} ${card.status} · ${card.title} · ${holder}`;
}

/** The state lines under a card's headline. */
function detailLines(card: Card): string[] {
	const lines: string[] = [];
	if (card.owner !== undefined) lines.push(`  owner: ${card.owner.label}`);
	if (card.plan !== undefined) lines.push(`  plan: ${card.plan}`);
	if (card.paths.length > 0) lines.push(`  paths: ${card.paths.join(", ")}`);
	if (card.notes.length > 0) {
		const last = card.notes.at(-1);
		if (last) lines.push(`  last note (${last.by}): ${last.text}`);
	}
	const dropped = card.notesDropped > 0 ? ` (${card.notesDropped} earlier dropped)` : "";
	lines.push(`  ${plural(card.notes.length, "note")}${dropped}`);
	return lines;
}

/** `#4 doing planned`, the brief a rollup group needs. */
function brief(card: Card): string {
	const planned = card.status === "doing" ? (card.plan === undefined ? " unplanned" : " planned") : "";
	return `${cardRef(card.id)} ${card.status}${planned}`;
}

/** One rollup group, or nothing when it is empty. */
function group(label: string, cards: readonly Card[], withReason = false): string[] {
	if (cards.length === 0) return [];
	const items = cards.map((card) => (withReason ? blockedBrief(card) : brief(card)));
	return [`${label} (${cards.length}): ${items.join(", ")}`];
}

/** A blocked card names the note that explains it, if there is one. */
function blockedBrief(card: Card): string {
	const last = card.notes.at(-1);
	return `${brief(card)}${last === undefined ? "" : ` — ${last.text}`}`;
}

/** `1 owner`, `2 owners`. */
export function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

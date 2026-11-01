/**
 * Folding finished cards away: the one sweep behind `board` action `archive` and `/board archive`.
 *
 * Archiving is one way — nothing un-archives — so the sweep is defined by what it refuses to
 * take: a finished card an open card still waits on stays on the board, because the link
 * survives the archive while the record loses the card it names. The set is `round.archivable`,
 * so the count the rollup prints and the cards a sweep moves are the same rule, not two.
 */

import { type Card, cardRef } from "../../lib/board/card.ts";
import { archivableOf } from "../../lib/board/round.ts";
import { plural } from "../../lib/board/round-text.ts";
import type { Actor } from "../../lib/board/rules.ts";
import type { BoardStore } from "../../lib/board/store.ts";
import { formatArchived } from "./format.ts";

/** What a sweep did: the cards it archived, the ones it could not, and the ones it left on purpose. */
export interface SweepResult {
	moved: string[];
	failed: Array<{ card: string; error: string }>;
	/** Finished cards an open card still waits on, which a sweep never takes. */
	kept: string[];
}

/**
 * Archive every finished card that nothing open still waits on.
 *
 * Best-effort over the board: a card that changed underneath the sweep is reported, because
 * "every finished card" must not read as fewer without a reason. `cards` is what the caller
 * already read, so a caller that just printed the rollup does not read the board twice.
 */
export async function sweepFinished(
	store: BoardStore,
	actor: Actor,
	now: number,
	cards?: readonly Card[],
): Promise<SweepResult> {
	const board = cards ?? (await store.list());
	const done = board.filter((card) => card.lane === "done");
	const archivable = new Set(archivableOf(board, done).map((card) => card.id));
	const result: SweepResult = { moved: [], failed: [], kept: [] };
	for (const card of done) {
		if (!archivable.has(card.id)) {
			result.kept.push(card.id);
			continue;
		}
		const outcome = await store.mutate(card.id, { kind: "archive" }, actor, now);
		if (!outcome.ok) result.failed.push({ card: card.id, error: outcome.error });
		else if (outcome.changed) result.moved.push(card.id);
	}
	return result;
}

/**
 * What a sweep says it did, as one line.
 *
 * Three answers, because three things can happen to the same call: cards folded away, cards
 * held back by a live link, and cards the store refused. A sweep that only reported the first
 * would read as a board with less history than it has.
 */
export function sweepText(result: SweepResult): string {
	const parts: string[] = [];
	if (result.moved.length > 0) parts.push(formatArchived(result.moved));
	if (result.kept.length > 0) {
		const them = result.kept.map(cardRef).join(", ");
		parts.push(`${plural(result.kept.length, "card")} kept: an open card still waits on ${them}.`);
	}
	for (const entry of result.failed) {
		parts.push(`${cardRef(entry.card)} was not archived (${entry.error}).`);
	}
	return parts.length === 0 ? "No finished cards to archive." : parts.join(" ");
}

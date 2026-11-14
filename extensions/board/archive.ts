/**
 * Folding finished cards away: the one sweep behind `board` action `archive` and `/board archive`.
 *
 * Archiving is one way — nothing un-archives — so the sweep is defined by what it refuses to
 * take: a finished card an open card still waits on stays on the board, because the link
 * survives the archive while the record loses the card it names. The set is `round.archivable`,
 * so the count the rollup prints and the cards a sweep moves are the same rule, not two.
 *
 * It can also be given a bound — `--older-than 30d` — so a card that finished this morning stays
 * where a reader looks for what just shipped. The bound is a choice rather than a default: an
 * archive that quietly stopped taking work would be a surprise, and a sweep that never says what
 * it left behind reads as "that was all of it" in the one sentence a person reads.
 */

import { textResult } from "../../lib/tool-result.ts";
import { type Card, cardRef, laneSince, normalizeCardId } from "../../lib/board/card.ts";
import { archivableOf } from "../../lib/board/round.ts";
import { plural } from "../../lib/board/round-text.ts";
import type { Actor } from "../../lib/board/rules.ts";
import type { BoardStore } from "../../lib/board/store.ts";
import { formatArchived } from "./format.ts";
import { refusal } from "./result.ts";
import type { BoardArgs } from "./schema.ts";
import type { ArchiveOutcome, BoardDetails } from "./types.ts";

/** One unit a bound may name, in milliseconds. */
const BOUND_UNITS: Readonly<Record<string, number>> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * An age bound as milliseconds: `30d`, `12h`, `90m`, `45s`, and nothing else.
 *
 * A whole number and one unit letter, so the spec a person mistypes — `/board archive 30d` with
 * no flag — is refused here rather than reaching a sweep, and refused again before it could read
 * as a card id. Zero is not a bound: a sweep that means everything says nothing at all.
 */
export function parseBound(spec: string): number | undefined {
	const match = /^([0-9]{1,6})([smhd])$/.exec(spec.trim().toLowerCase());
	if (match === null) return undefined;
	const unit = BOUND_UNITS[match[2] ?? ""];
	const amount = Number(match[1]);
	if (unit === undefined || !Number.isInteger(amount) || amount <= 0) return undefined;
	return amount * unit;
}

/** What a caller's `olderThan` said: the bound, no bound at all, or the sentence refusing it. */
export type BoundRead = { ok: true; bound?: SweepBound } | { ok: false; error: string };

/**
 * The bound a spec names, or the sentence saying it names none.
 *
 * Both doors start from words a person typed, and both must refuse the same things in the same
 * sentence — most of all a bound that lost its flag (`/board archive 30d`), whose shape is a card
 * id. Nothing is swept when this refuses, which the sentence says rather than leaves to be hoped.
 */
export function boundOf(spec: string | undefined): BoundRead {
	if (spec === undefined) return { ok: true };
	const ms = parseBound(spec);
	if (ms === undefined) {
		return { ok: false, error: `"${spec}" is not an age — write one like 30d, 12h, or 90m. Nothing was swept.` };
	}
	return { ok: true, bound: { spec, ms } };
}

/**
 * The bound a `/board archive` tail names, or the sentence refusing it.
 *
 * The command's grammar, beside the spec it reads, so the one mistake that matters is a case
 * rather than a reading of the handler: `/board archive 30d` with the flag left off is a word
 * that looks exactly like a card id, and what it must produce is a refusal that swept nothing.
 */
export function boundFromCommand(rest: readonly string[]): BoundRead {
	const [flag, spec, ...extra] = rest;
	if (rest.length === 0) return { ok: true };
	if (flag !== "--older-than" || spec === undefined || extra.length > 0) {
		return {
			ok: false,
			error: "`/board archive` takes `--older-than <age>` — 30d, 12h, 90m — and nothing else. Nothing was swept.",
		};
	}
	return boundOf(spec);
}

/**
 * When a card finished, as far as its own file says.
 *
 * `laneSince` is the fact — the stamp of the transition into the lane the card is in — and a file
 * whose log was elided has only `updatedAt`. The fallback keeps a card longer than its lane age
 * rather than shorter, which is the direction a bound has to err in: a note on a finished card
 * means somebody is still reading it.
 */
export function closedAt(card: Card): number {
	return laneSince(card) ?? card.updatedAt;
}

/** A sweep's limit: the spec as the caller wrote it, and its width in milliseconds. */
export interface SweepBound {
	spec: string;
	ms: number;
}

/**
 * Archive every finished card that nothing open still waits on, and that clears the bound.
 *
 * Best-effort over the board: a card that changed underneath the sweep is reported, because
 * "every finished card" must not read as fewer without a reason. `cards` is what the caller
 * already read, so a caller that just printed the rollup does not read the board twice. `within`
 * is the bound, absent for a sweep of everything.
 */
export async function sweepFinished(
	store: BoardStore,
	actor: Actor,
	now: number,
	cards?: readonly Card[],
	within?: SweepBound,
): Promise<ArchiveOutcome> {
	const board = cards ?? (await store.list());
	const done = board.filter((card) => card.lane === "done");
	const archivable = new Set(archivableOf(board, done).map((card) => card.id));
	const result: ArchiveOutcome = {
		moved: [],
		failed: [],
		kept: [],
		held: [],
		...(within ? { bound: within.spec } : {}),
	};
	for (const card of done) {
		if (!archivable.has(card.id)) {
			result.kept.push(card.id);
			continue;
		}
		if (within !== undefined && now - closedAt(card) < within.ms) {
			result.held.push(card.id);
			continue;
		}
		const outcome = await store.mutate(card.id, { kind: "archive" }, actor, now);
		if (!outcome.ok) result.failed.push({ card: card.id, error: outcome.error });
		else if (outcome.changed) result.moved.push(card.id);
	}
	return result;
}

/**
 * `archive`: a finished card leaves the board without being destroyed.
 *
 * One card, or — with no card named — every finished card, because clearing a board is
 * the errand and a lead should not run sixty calls. Each move is its own locked read-check-write,
 * so a sweep is best-effort (a rival's move can still be refused) and reports what it set aside.
 */
export async function archiveCards(
	store: BoardStore,
	me: BoardDetails["me"],
	args: BoardArgs,
	now: number,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	if (args.card !== undefined) {
		if (args.olderThan !== undefined) {
			return refusal("archive", me, "`olderThan` sizes a sweep, so it takes no `card`: archive the card by naming it.");
		}
		const id = normalizeCardId(args.card);
		if (id === undefined) return refusal("archive", me, `"${args.card}" is not a card id.`);
		const result = await store.mutate(id, { kind: "archive" }, me, now);
		if (!result.ok) return refusal("archive", me, result.error, result.card);
		// Asked twice is one state, not an error: the card is where the caller wanted it.
		if (!result.changed)
			return textResult(`${cardRef(id)} is already archived.`, {
				action: "archive",
				me,
				archive: { moved: [], kept: [], held: [], failed: [], already: id },
			});
		return textResult(formatArchived([id]), {
			action: "archive",
			me,
			archive: { moved: [id], kept: [], held: [], failed: [] },
		});
	}
	// One sweep, shared with `/board archive`: the numbers the rollup prints and the cards it
	// moves are one rule, and a finished card an open one still waits on is never taken.
	// Read before the board is even listed, so a spec a person mistyped cannot reach a sweep.
	const read = boundOf(args.olderThan);
	if (!read.ok) return refusal("archive", me, read.error);
	const swept = await sweepFinished(store, me, now, await store.list(), read.bound);
	if (swept.moved.length === 0 && swept.failed.length === 0 && swept.kept.length === 0 && swept.held.length === 0) {
		return textResult("No finished cards to archive.", {
			action: "archive",
			me,
			archive: { moved: [], kept: [], held: [], failed: [] },
		});
	}
	return textResult(sweepText(swept), { action: "archive", me, archive: swept });
}

/**
 * What a sweep says it did, as one line.
 *
 * Four answers, because four things can happen to the same call: cards folded away, cards held
 * back by a live link, cards the bound left where they are, and cards the store refused. A sweep
 * that only reported the first would read as a board with less history than it has — and a bounded
 * one that stayed silent about the bound would read as "that was all of it".
 */
export function sweepText(result: ArchiveOutcome): string {
	const parts: string[] = [];
	if (result.moved.length > 0) parts.push(formatArchived(result.moved));
	if (result.kept.length > 0) {
		const them = result.kept.map(cardRef).join(", ");
		parts.push(`${plural(result.kept.length, "card")} kept: an open card still waits on ${them}.`);
	}
	if (result.held.length > 0 && result.bound !== undefined) {
		parts.push(`${plural(result.held.length, "card")} stayed: finished within ${result.bound}.`);
	}
	for (const entry of result.failed) {
		parts.push(`${cardRef(entry.card)} was not archived (${entry.error}).`);
	}
	return parts.length === 0 ? "No finished cards to archive." : parts.join(" ");
}

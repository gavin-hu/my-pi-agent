/**
 * The shelf: a pool card set aside, and the one line saying why.
 *
 * A `backlog` card nobody holds is the pool; a shelved one is the pool's icebox — still
 * nobody's, still on the board, and out of the rollup's unassigned count and out of every
 * offer until somebody takes it back. The fact lives beside the card rather than in a lane,
 * because a lane is where a card is *worked* and a shelf is a decision about the pool: no
 * claim, no owner, no WIP slot, and reachable by the seat, which cannot claim one.
 *
 * `at` is when it went aside and stays put when a repeat `shelve` fixes the reason; `until`
 * is a moment, computed by the write from the caller's `30d`, never a spec — the record does
 * not carry a spelling. Nothing wakes a card: a passed `until` is a sentence the card's own
 * line prints, not a move, and this board has no janitor.
 *
 * Split out of `card.ts` with `block.ts`, its sibling: the two are the card's set-aside
 * facts, and the record module sits at the module bar.
 *
 * Value-only: no I/O, no state.
 */

import { overLimit, sanitizeLine } from "../format.ts";
import { MAX_BLOCKED } from "./block.ts";
import { type Card, cardRef } from "./card.ts";
import { LANE_RULES } from "./lanes.ts";
import type { Actor, CardOp, Prepared } from "./rules.ts";

/** A card set aside: when, by whom, why, and — when the caller said so — until when. */
export interface CardShelved {
	/** When it went aside, on the board's clock; kept when a repeat `shelve` fixes the reason. */
	at: number;
	/** The label of whoever set it aside. */
	by: string;
	/** Why, in one line: the reason a reader acts on, and what the round prints. */
	note: string;
	/** The moment it was bounded to, when the caller gave one; a passed moment moves nothing. */
	until?: number;
}

/**
 * The reason a shelf records, as stored: one line, or the sentence saying why it cannot be.
 *
 * The cap is {@link MAX_BLOCKED} rather than a second 200: both are the one-line reason a
 * lane row holds, and two constants with one number is two answers to one question.
 */
export function normalizeShelfNote(raw: unknown): { note: string } | { error: string } {
	if (typeof raw !== "string") return { error: "note is required: say why the card is set aside." };
	const note = sanitizeLine(raw).trim();
	if (note === "") return { error: "note is required: say why the card is set aside." };
	if (note.length > MAX_BLOCKED) return { error: overLimit("note", note.length, MAX_BLOCKED) };
	return { note };
}

/**
 * Whether `value` is a shelf this build can read: a moment, an author, and a why.
 *
 * A hand-edited file that lost any of the three is not a shelf. The reason is the whole
 * point of the record, and a card that reads as "set aside for no reason" is worse than one
 * that reads as pool work nobody has picked up yet.
 */
export function isShelved(value: unknown): value is CardShelved {
	if (typeof value !== "object" || value === null) return false;
	const shelved = value as Record<string, unknown>;
	if (!Number.isInteger(shelved.at)) return false;
	if (typeof shelved.by !== "string" || shelved.by === "") return false;
	if (typeof shelved.note !== "string" || shelved.note === "" || shelved.note.length > MAX_BLOCKED) return false;
	return shelved.until === undefined || Number.isInteger(shelved.until);
}

/**
 * Set a pool card aside: still nobody's, still on the board, and out of the way.
 *
 * A shelf is a decision about the pool rather than a lane, so this needs no claim, no owner and no
 * WIP slot — which is the point: the seat, which cannot claim a card, still has to be able to say
 * "not now". A held card is refused with its route, because a release is the holder's decision and
 * not one a shelve may take on their behalf. A repeat fixes the reason, the answer a repeated
 * `blocked` gives, and keeps `at`: the card has been aside since it went aside.
 *
 * Beside the record rather than in `steps.ts` with the other operations for the reason that module
 * gives for `lead.ts`: the two halves are one job — the shelf — and the step and the field arrive
 * together.
 */
export function shelve(card: Card, op: Extract<CardOp, { kind: "shelve" }>, actor: Actor, now: number): Prepared {
	if (LANE_RULES[card.lane].terminal) return { error: `${cardRef(card.id)} is done; it cannot be shelved.` };
	if (card.lane !== "backlog") {
		return {
			error: `${cardRef(card.id)} is in ${card.lane}; only a pool card can be shelved — \`board release ${card.id}\` puts it back.`,
		};
	}
	const reason = normalizeShelfNote(op.note);
	if ("error" in reason) return { error: reason.error };
	// The door reads `30d` and hands a width; this is the same fact met at the rules boundary, so a
	// caller that skipped the door is refused rather than storing a moment that is not one.
	if (op.until !== undefined && (typeof op.until !== "number" || !Number.isInteger(op.until) || op.until <= 0)) {
		return { error: "until must be a length of time in whole milliseconds." };
	}
	const shelved: CardShelved = {
		at: card.shelved?.at ?? now,
		by: actor.label,
		note: reason.note,
		...(op.until === undefined ? {} : { until: now + op.until }),
	};
	// The same sentence is the same shelf: nothing is written and the revision does not move.
	if (card.shelved !== undefined && card.shelved.note === shelved.note && card.shelved.until === shelved.until) {
		return { changed: false, fields: null };
	}
	// An offer is answered by the shelf, so the two facts never sit on one card.
	return { changed: true, fields: { shelved, offeredAt: undefined } };
}

/**
 * Put a shelved card back in the pool.
 *
 * The card never left `backlog`, so there is no lane to change and no transition to log: the field
 * is deleted by the one write that clears it. Unshelving what was never shelved is a no-op rather
 * than an error, the way claiming a card you already hold is.
 */
export function unshelve(card: Card): Prepared {
	if (card.shelved === undefined) return { changed: false, fields: null };
	return { changed: true, fields: { shelved: undefined } };
}

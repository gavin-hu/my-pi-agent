/**
 * What has happened on the board lately: the Team tab's Recent rail, derived.
 *
 * Nothing records an activity log. Every event here is a fact the cards already keep —
 * a lane transition in a card's `log`, a note, a contract's approval, a spot-check, an
 * open offer — and the rail is those facts merged and capped. A stored feed would be a
 * second history, and the first write to one of them would make the page and the card
 * disagree about what happened to it.
 *
 * Two rules, both about honesty:
 *
 * - **Newest first, then by card id**, so two events in one second draw in one order on
 *   every machine. The clock is the record's; this module reads none of its own.
 * - **A count of what the cap left out.** The rail shows ten; a board with forty events
 *   says so rather than reading like a quiet one.
 *
 * `logDropped` and `notesDropped` are the cards' own bounds, not a gap this module can
 * fill: a card that elided its history contributes the events it still holds, and no
 * event is invented for the ones it let go.
 *
 * Value-only: no I/O, no clock, no state.
 */

import type { Card } from "./card.ts";
import type { Lane } from "./lanes.ts";

/** What kind of thing happened, in the order the rail labels them. */
export const ACTIVITY_KINDS = ["blocked", "moved", "approved", "reviewed", "noted", "offered"] as const;

/** One kind of activity. */
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * The word a rail row prints for each kind, beside its glyph.
 *
 * A move names its lane instead ("moved to execute"), so its label is a verb the page
 * completes; every other kind is one phrase. One table, because a row that says "spot-checked"
 * in the rail and "reviewed" in the dialog is two words for one event.
 */
export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
	blocked: "blocked",
	moved: "moved to {lane}",
	approved: "contract approved",
	reviewed: "spot-checked",
	noted: "noted",
	offered: "offered",
};

/** {@link ACTIVITY_LABEL} as the browser bundle's own source, spliced in like the tone tables. */
export const ACTIVITY_LABEL_JS = JSON.stringify(ACTIVITY_LABEL);

/** {@link ACTIVITY_KINDS} as the bundle's own source: the rail reads no kind this list lacks. */
export const ACTIVITY_KINDS_JS = JSON.stringify(ACTIVITY_KINDS);

/** How many events the rail shows before it is a history with its own card. */
export const ACTIVITY_LIMIT = 10;

/** One thing that happened to one card. */
export interface ActivityEvent {
	kind: ActivityKind;
	/** The card it happened to, which is what the row links to. */
	card: string;
	/** The card's title when the event was read, for the row's tooltip. */
	title: string;
	/** When it happened, as the record wrote it. */
	at: number;
	/**
	 * The lane a move went to, or the lane a card was blocked in.
	 *
	 * Present for the two kinds whose colour says where the card sits; absent for the rest,
	 * which are about the card rather than about a lane.
	 */
	lane?: Lane;
}

/** The rail as the page draws it: the newest events, and how many the cap left out. */
export interface ActivityFeed {
	/** Newest first, at most the cap. */
	events: ActivityEvent[];
	/** How many more the board holds: the caption's "10 of 24". */
	dropped: number;
}

/**
 * Every event the board's cards can prove, newest first, at most `limit`.
 *
 * One pass per card over four small records — its transitions, its notes, its approval,
 * its spot-check — and one offer, which is a stamp rather than a log entry.
 */
export function activityOf(cards: readonly Card[], limit = ACTIVITY_LIMIT): ActivityFeed {
	const all: ActivityEvent[] = [];
	for (const card of cards) {
		for (const entry of card.log ?? []) {
			all.push({
				kind: entry.lane === "blocked" ? "blocked" : "moved",
				card: card.id,
				title: card.title,
				at: entry.at,
				lane: entry.lane,
			});
		}
		for (const note of card.notes) {
			all.push({ kind: "noted", card: card.id, title: card.title, at: note.at });
		}
		const approved = card.contract?.approved;
		if (approved !== undefined) all.push({ kind: "approved", card: card.id, title: card.title, at: approved.at });
		if (card.review !== undefined) all.push({ kind: "reviewed", card: card.id, title: card.title, at: card.review.at });
		if (card.offeredAt !== undefined) {
			all.push({ kind: "offered", card: card.id, title: card.title, at: card.offeredAt });
		}
	}
	// The id breaks a tie and settles nothing else: two events stamped in one second are two
	// rows, and a board read twice must draw them in one order.
	all.sort((a, b) => b.at - a.at || a.card.localeCompare(b.card) || a.kind.localeCompare(b.kind));
	const kept = all.slice(0, Math.max(0, limit));
	return { events: kept, dropped: all.length - kept.length };
}

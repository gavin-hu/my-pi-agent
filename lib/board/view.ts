/**
 * The snapshot: the one shape the page knows, built on the server.
 *
 * The browser is a dumb renderer over this record, so the lanes, the counts, the
 * rollup, and the store's size are decided in one place and a client cannot invent
 * a state the model surface would not report. `sig` is what makes a push cheap:
 * the page is re-sent only when a card's revision moved.
 *
 * `where` is the store's own path, shortened, so a reader can tell which directory
 * a shared board is filed under — and so nothing here needs a "remote" variant that
 * no backend produces.
 *
 * Pure: the caller supplies the cards, the clock, and the sizes it read.
 */

import { type Card, CARD_STATUSES, type CardStatus, signatureOf } from "./card.ts";
import type { Actor } from "./rules.ts";
import { buildRound, type RoundSummary } from "./round.ts";

/** One lane and the cards in it, in the order the page draws them. */
export interface ViewLane {
	status: CardStatus;
	cards: Card[];
}

/** The per-lane tallies the toolbar shows. */
export interface ViewCounts {
	total: number;
	todo: number;
	doing: number;
	blocked: number;
	done: number;
}

/** Everything the page is allowed to know. */
export interface BoardView {
	/** The session a page write is made as — the serving one, never the browser. */
	me: { id?: string; label: string };
	lanes: ViewLane[];
	counts: ViewCounts;
	round: RoundSummary;
	/** Bytes the store occupies, so a board that is never pruned says so. */
	bytes: number;
	/** Changes exactly when a card's revision does. */
	sig: string;
	/** The store's directory, shortened. */
	where: string;
}

/** What the server read before building one snapshot. */
export interface ViewInput {
	me: Actor;
	cards: readonly Card[];
	now: number;
	bytes: number;
	where: string;
}

/** Build the page's snapshot. */
export function buildView(input: ViewInput): BoardView {
	const lanes = CARD_STATUSES.map((status) => ({
		status,
		cards: input.cards.filter((card) => card.status === status),
	}));
	return {
		me: input.me.id === undefined ? { label: input.me.label } : { id: input.me.id, label: input.me.label },
		lanes,
		counts: countOf(lanes),
		round: buildRound(input.cards, input.now),
		bytes: input.bytes,
		sig: signatureOf(input.cards),
		where: input.where,
	};
}

/** The tallies, summed from the lanes so the two can never disagree. */
function countOf(lanes: readonly ViewLane[]): ViewCounts {
	const counts: ViewCounts = { total: 0, todo: 0, doing: 0, blocked: 0, done: 0 };
	for (const lane of lanes) {
		counts[lane.status] = lane.cards.length;
		counts.total += lane.cards.length;
	}
	return counts;
}

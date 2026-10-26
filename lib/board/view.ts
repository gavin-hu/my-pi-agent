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

import { type RosterSession, type RosterState, rosterStateOf } from "../session-roster.ts";
import { type Card, CARD_STATUSES, type CardStatus, priorityOf, type Priority, signatureOf } from "./card.ts";
import { blockersOf, blockersText, indexOf } from "./links.ts";
import type { Actor } from "./rules.ts";
import { buildRound, type RoundSummary } from "./round.ts";

/** One session on the repository's bus, as the Team tab lists it. */
export interface ViewTeammate {
	label: string;
	/** `live` while its heartbeat holds, `quiet` once the record has aged out, `gone` once its process is not running. */
	state: RosterState;
	/** When it last proved it was there. */
	seen: number;
	/** Messages waiting in its inbox. */
	mail: number;
	/** Whether it is listening for mail; absent means its record does not say so. */
	listening?: boolean;
	/** Whether this is the session the page writes as. */
	you: boolean;
}

/**
 * One card as the page meets it: the stored card, plus the two answers it would
 * otherwise compute for itself.
 *
 * Both are derived from the board, not stored on the card, so a client that did the
 * same work would be a second copy of a rule — and the copies drift, which is how the
 * page came to disagree with the tool about what a card waits for.
 */
export interface ViewCard extends Card {
	/** The priority it acts on: a card that never set one is ordinary. */
	priority: Priority;
	/**
	 * The unfinished cards it waits for, as `#2 (doing)`; absent when nothing blocks it.
	 *
	 * `undefined` is the whole fact — a waiting card is one with a `waits` — because a
	 * boolean beside it would be one more thing that can disagree with the string.
	 */
	waits?: string;
}

/** One lane and the cards in it, in the order the page draws them. */
export interface ViewLane {
	status: CardStatus;
	cards: ViewCard[];
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
	/** The session a page write is made as — the page's seat, never the browser. */
	me: { id?: string; label: string };
	/** The session the page is served from, when the page knows it: who is reading. */
	session?: { id?: string; label: string };
	lanes: ViewLane[];
	counts: ViewCounts;
	round: RoundSummary<ViewCard>;
	/**
	 * The sessions on this repository's bus, or absent when there is no bus here.
	 *
	 * Absent is not empty: a page with no roster cannot say who is around, while an
	 * empty one can say nobody is — and the tab draws those two answers differently.
	 */
	teammates?: ViewTeammate[];
	/** Bytes the store occupies, so a board that is never pruned says so. */
	bytes: number;
	/**
	 * Card files the reader refused, so the footer can say the board is not empty.
	 *
	 * Zero is the ordinary answer and draws nothing; a count above it is the one fact
	 * that separates "no work here" from "this build cannot read your work".
	 */
	skipped: number;
	/** Changes when a card's revision, a teammate's state, or its mail does. */
	sig: string;
	/** The store's directory, shortened. */
	where: string;
}

/** What the server read before building one snapshot. */
export interface ViewInput {
	me: Actor;
	/**
	 * The session the page is served from, when it has one.
	 *
	 * The page writes as its seat — a fixed name — so the reader's own row on the Team
	 * tab is marked from the session, not from `me`: the seat is what a card records,
	 * and the session is who is looking.
	 */
	session?: Actor;
	cards: readonly Card[];
	now: number;
	bytes: number;
	/** Card files the reader refused; absent reads as none, which is the ordinary board. */
	skipped?: number;
	where: string;
	/** The bus's records, when the page could read them at all. */
	roster?: readonly RosterSession[];
}

/** Build the page's snapshot. */
export function buildView(input: ViewInput): BoardView {
	// One index for the whole snapshot: a card's lane and its blockers are read from the
	// same board, so a dependency and its dependent cannot be told two different stories.
	const index = indexOf(input.cards);
	// One mapped list feeds both halves of the snapshot: the rollup's groups carry the same
	// card the lane does, so a client reading `round.unassigned` is not handed a card
	// missing the facts every other card has.
	const cards = input.cards.map((card) => viewCardOf(card, index));
	const lanes = CARD_STATUSES.map((status) => ({
		status,
		cards: cards.filter((card) => card.status === status),
	}));
	const reader = input.session ?? input.me;
	const teammates = input.roster === undefined ? undefined : teammatesOf(input.roster, reader.label, input.now);
	return {
		me: input.me.id === undefined ? { label: input.me.label } : { id: input.me.id, label: input.me.label },
		...(input.session === undefined ? {} : { session: input.session }),
		lanes,
		counts: countOf(lanes),
		round: buildRound(cards, input.now),
		...(teammates === undefined ? {} : { teammates }),
		bytes: input.bytes,
		skipped: input.skipped ?? 0,
		// The roster enters the signature at its coarse facts only: a heartbeat every ten
		// seconds is not news, while a join, a quiet and a letter are.
		sig: signatureOf(input.cards) + rosterSignature(teammates),
		where: input.where,
	};
}

/**
 * One card for the page: what it carries, plus what it acts on.
 *
 * The card is copied rather than annotated — the caller's cards are the store's, and a
 * derived field written onto one would outlive the read that made it.
 */
function viewCardOf(card: Card, index: ReadonlyMap<string, Card>): ViewCard {
	const waits = blockersText(blockersOf(card, index));
	return { ...card, priority: priorityOf(card), ...(waits === "" ? {} : { waits }) };
}

/** The roster as the page shows it, ordered so a repaint never reorders it. */
function teammatesOf(roster: readonly RosterSession[], meLabel: string, now: number): ViewTeammate[] {
	return roster
		.map((session) => ({
			label: session.label,
			state: rosterStateOf(session, now),
			seen: session.lastSeen,
			mail: session.mail,
			// A record that does not say is not a promise either way, so the fact is left out
			// rather than drawn as "not listening".
			...(session.watching === undefined ? {} : { listening: session.watching.armed }),
			you: session.label.toLowerCase() === meLabel.toLowerCase(),
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** What a frame must know about the roster; `seen` is left out on purpose. */
function rosterSignature(teammates: readonly ViewTeammate[] | undefined): string {
	if (teammates === undefined) return "";
	return (
		"|" +
		teammates.map((teammate) => `${teammate.label}:${teammate.state}:${teammate.mail}:${teammate.listening}`).join(",")
	);
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

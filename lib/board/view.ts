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

import { type RosterSession, rosterStateOf } from "../session-roster.ts";
import { type Card, CARD_STATUSES, type CardStatus, signatureOf } from "./card.ts";
import type { Actor } from "./rules.ts";
import { buildRound, type RoundSummary } from "./round.ts";

/** One session on the repository's bus, as the Team tab lists it. */
export interface ViewTeammate {
	label: string;
	/** `live` while its heartbeat holds, `quiet` once the record has aged out. */
	state: "live" | "quiet";
	/** When it last proved it was there. */
	seen: number;
	/** Messages waiting in its inbox. */
	mail: number;
	/** Whether this is the session the page writes as. */
	you: boolean;
}

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
	/**
	 * The sessions on this repository's bus, or absent when there is no bus here.
	 *
	 * Absent is not empty: a page with no roster cannot say who is around, while an
	 * empty one can say nobody is — and the tab draws those two answers differently.
	 */
	teammates?: ViewTeammate[];
	/** Bytes the store occupies, so a board that is never pruned says so. */
	bytes: number;
	/** Changes when a card's revision, a teammate's state, or its mail does. */
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
	/** The bus's records, when the page could read them at all. */
	roster?: readonly RosterSession[];
}

/** Build the page's snapshot. */
export function buildView(input: ViewInput): BoardView {
	const lanes = CARD_STATUSES.map((status) => ({
		status,
		cards: input.cards.filter((card) => card.status === status),
	}));
	const teammates = input.roster === undefined ? undefined : teammatesOf(input.roster, input.me.label, input.now);
	return {
		me: input.me.id === undefined ? { label: input.me.label } : { id: input.me.id, label: input.me.label },
		lanes,
		counts: countOf(lanes),
		round: buildRound(input.cards, input.now),
		...(teammates === undefined ? {} : { teammates }),
		bytes: input.bytes,
		// The roster enters the signature at its coarse facts only: a heartbeat every ten
		// seconds is not news, while a join, a quiet and a letter are.
		sig: signatureOf(input.cards) + rosterSignature(teammates),
		where: input.where,
	};
}

/** The roster as the page shows it, ordered so a repaint never reorders it. */
function teammatesOf(roster: readonly RosterSession[], meLabel: string, now: number): ViewTeammate[] {
	return roster
		.map((session) => ({
			label: session.label,
			state: rosterStateOf(session, now),
			seen: session.lastSeen,
			mail: session.mail,
			you: session.label.toLowerCase() === meLabel.toLowerCase(),
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** What a frame must know about the roster; `seen` is left out on purpose. */
function rosterSignature(teammates: readonly ViewTeammate[] | undefined): string {
	if (teammates === undefined) return "";
	return "|" + teammates.map((teammate) => `${teammate.label}:${teammate.state}:${teammate.mail}`).join(",");
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

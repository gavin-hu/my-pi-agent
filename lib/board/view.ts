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
 * no backend produces. `repo` and `root` are the same board said aloud: the repository
 * root's own name, which a tab can carry, and its whole path for the hover title.
 *
 * Pure: the caller supplies the cards, the clock, and the sizes it read.
 */

import { type RosterSession, type RosterState, rosterStateOf } from "../session-roster.ts";
import { type Card, laneSince, priorityOf, type Priority, signatureOf } from "./card.ts";
import type { Skip } from "./store.ts";
import { LANE_RULES, LANES, type Lane, type LaneRole } from "./lanes.ts";
import { DEFAULT_WIP, limitOf, type WipLimits } from "./limits.ts";
import { blockersOf, indexOf, lanesText, openDependentsOf } from "./links.ts";
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
	 * The unfinished cards it waits for, as `#2 (execute)`; absent when nothing blocks it.
	 *
	 * `undefined` is the whole fact — a waiting card is one with a `waits` — because a
	 * boolean beside it would be one more thing that can disagree with the string.
	 */
	waits?: string;
	/**
	 * The unfinished cards waiting on it, as `#9 (backlog)`; absent when none do.
	 *
	 * The other side of `waits`: what leaving this card undone holds up. Derived here
	 * rather than in the page's script for the same reason, and filtered to the unfinished
	 * for the same reason a finished blocker does not count.
	 */
	dependents?: string;
	/**
	 * When the card entered the lane it is in now, or absent when its history does not say.
	 *
	 * A timestamp rather than a phrase: the page already formats ages, and a wording
	 * decided here would be a second copy of that rule. Absent is the honest answer for a
	 * card written before the log existed, so the page draws no age rather than guessing
	 * one from `updatedAt`, which moves on every write.
	 */
	since?: number;
}

/**
 * One lane, as the page draws it: the name, the words, the colour, the limit, and the cards.
 *
 * The page holds no lane table of its own — it renders this — so a lane's label, its empty
 * word, and its head's `n/limit` cannot read one way here and another in the transcript.
 */
export interface ViewLane {
	key: Lane;
	/** The word a head, a row, and a sentence print. */
	label: string;
	/** What the tray says when it holds nothing. */
	empty: string;
	/** The colour role the lane's dot and its card faces take. */
	role: LaneRole;
	/** The WIP limit this lane is held to, for the heads that show `n/limit`; absent when it is not pulled. */
	limit?: number;
	count: number;
	cards: ViewCard[];
}

/** Everything the page is allowed to know. */
export interface BoardView {
	/**
	 * The session a page write is made as, and the one the page is read as: its seat.
	 *
	 * The page is not a session that happens to be serving — it is a seat that outlives
	 * whichever session serves it — so the browser is told one identity and no other.
	 */
	me: { id?: string; label: string };
	lanes: ViewLane[];
	/** Every card on the board: the sum of the lanes, said once so a head need not add them up. */
	total: number;
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
	 * An empty list is the ordinary answer and draws nothing; anything in it is the one fact
	 * that separates "no work here" from "this build cannot read your work" — and the file
	 * names and reasons are what let a reader open the file, so the page carries them whole.
	 */
	skipped: readonly Skip[];
	/** Changes when a card's revision, a teammate's state, or its mail does. */
	sig: string;
	/** The root's last segment, e.g. `my-pi-agent`: what the tab and the footer lead with. */
	repo: string;
	/** The repository root, absolute, so the footer can put the whole path on hover. */
	root: string;
	/** The store's directory, shortened. */
	where: string;
}

/** What the server read before building one snapshot. */
export interface ViewInput {
	/** The page's own actor, which is both who it writes as and who is looking. */
	me: Actor;
	cards: readonly Card[];
	now: number;
	bytes: number;
	/** Card files the reader refused; absent reads as none, which is the ordinary board. */
	skipped?: readonly Skip[];
	where: string;
	/** The repository's name, from `BoardStore.name()`. */
	repo: string;
	/** The repository root, from `BoardStore.root()`. */
	root: string;
	/** The bus's records, when the page could read them at all. */
	roster?: readonly RosterSession[];
	/** The board's WIP limits, so a head can say `n/limit`; absent reads as the defaults. */
	limits?: WipLimits;
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
	const limits = input.limits ?? DEFAULT_WIP;
	const lanes = LANES.map((key) => {
		const rule = LANE_RULES[key];
		const inLane = cards.filter((card) => card.lane === key);
		const limit = limitOf(key, limits);
		return {
			key,
			label: rule.label,
			empty: rule.empty,
			role: rule.role,
			...(limit === undefined ? {} : { limit }),
			count: inLane.length,
			cards: inLane,
		};
	});
	const reader = input.me;
	const teammates = input.roster === undefined ? undefined : teammatesOf(input.roster, reader.label, input.now);
	return {
		me: input.me.id === undefined ? { label: input.me.label } : { id: input.me.id, label: input.me.label },
		lanes,
		total: cards.length,
		round: buildRound(cards, input.now),
		...(teammates === undefined ? {} : { teammates }),
		bytes: input.bytes,
		skipped: input.skipped ?? [],
		// The roster enters the signature at its coarse facts only: a heartbeat every ten
		// seconds is not news, while a join, a quiet and a letter are. A file that became
		// readable, or unreadable, is news too, and so is a *different* file becoming
		// unreadable: the footer names them, so the signature carries the names and reasons
		// rather than a count that a swap would leave unchanged.
		sig:
			signatureOf(input.cards) +
			rosterSignature(teammates) +
			`|skipped:${(input.skipped ?? []).map((entry) => `${entry.file}:${entry.why}`).join(",")}`,
		repo: input.repo,
		root: input.root,
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
	const waits = lanesText(blockersOf(card, index));
	const dependents = lanesText(openDependentsOf(card.id, index));
	const since = laneSince(card);
	return {
		...card,
		priority: priorityOf(card),
		...(waits === "" ? {} : { waits }),
		...(dependents === "" ? {} : { dependents }),
		...(since === undefined ? {} : { since }),
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

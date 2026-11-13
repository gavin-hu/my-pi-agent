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

import { homedir } from "node:os";
import {
	presenceOf,
	type RosterSession,
	type RosterState,
	rosterStateOf,
	type SessionPresence,
} from "../session-roster.ts";
import type { WaitingPage } from "../session-mail.ts";
import { sameLabel } from "../session-label.ts";
import { type ActivityFeed, activityOf } from "./activity.ts";
import { type Card, laneSince, priorityOf, type Priority, signatureOf } from "./card.ts";
import type { Skip } from "./store.ts";
import { LANE_RULES, LANES, type Lane, type LaneRole } from "./lanes.ts";
import { DEFAULT_WIP, limitOf, type WipLimits } from "./limits.ts";
import { blockersOf, indexOf, lanesText, openDependentsOf } from "./links.ts";
import { withLiveOwner } from "./round-text.ts";
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
	/** Whether this is the seat the page is read as. */
	you: boolean;
	/**
	 * Whether the bus says it is inside a turn right now; absent when it is not.
	 *
	 * A stamp is believed only beside a fresh heartbeat: a process that died mid-run left
	 * `turnAt` behind, and a `quiet` record says nothing about what it is doing. Absent rather
	 * than `false`, the idiom every other derived flag on a card follows — a fact that is not
	 * there is not drawn.
	 */
	working?: true;
	/**
	 * Whether this row holds the board's lead role, from the configured name; absent when not.
	 *
	 * Not the same fact as `you`: the page serves as the lead, so on most boards the two
	 * are one row and the same seat — but a board that renames its lead must still point
	 * at the row its gates will answer, and a reader must be able to see the rename.
	 */
	lead?: true;
}

/** One recipient of a waiting message, and what the bus says about it. */
export interface ViewRecipient {
	label: string;
	/** `absent` when the roster holds no record; absent when this repository has no bus to ask. */
	state?: SessionPresence;
}

/** One message waiting on the bus, with each recipient's state resolved. */
export interface ViewWaiting extends Omit<WaitingPage["messages"][number], "to"> {
	to: ViewRecipient[];
}

/** The waiting queue as the page draws it: the oldest rows, and what the cap left out. */
export interface ViewWaitingPage {
	messages: ViewWaiting[];
	dropped: number;
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
	 * The unfinished cards it waits for, as `#2 (execute) Patch the gateway`; absent when
	 * nothing blocks it.
	 *
	 * `undefined` is the whole fact — a waiting card is one with a `waits` — because a
	 * boolean beside it would be one more thing that can disagree with the string.
	 */
	waits?: string;
	/**
	 * The unfinished cards waiting on it, as `#9 (backlog) Ship the picker`; absent when none
	 * do.
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
	/**
	 * The plan it recorded is no longer in the plan store.
	 *
	 * Derived by the server, which is the only side that can stat: the reason body is spliced into
	 * the browser and cannot read a file. Absent is the ordinary answer — a card with no plan, a
	 * card whose plan is there, and a card in a lane no gate asks the question from.
	 */
	planGone?: true;
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
	/**
	 * Mail nobody has read, oldest first, at most the reader's cap — and the count of what
	 * that cap left out, so a deep queue does not draw like a quiet one.
	 *
	 * Never consumed: `session-bus` owns the inbox, and a page that deleted what it drew
	 * would eat the mail it was describing.
	 */
	waiting: ViewWaitingPage;
	/** What the board's cards have to say has happened lately, and how much is beyond the cap. */
	activity: ActivityFeed;
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
	/**
	 * Changes when a card's revision, a teammate's state, or its mail does — and when the
	 * rollup's clock pushes a card into `unwritten`.
	 *
	 * A membership that time alone decides has to be in here, or the ticker compares two
	 * equal signatures and the tab never hears that a card went quiet.
	 */
	sig: string;
	/** The root's last segment, e.g. `my-pi-agent`: what the tab and the footer lead with. */
	repo: string;
	/** The repository root, absolute, so the footer can put the whole path on hover. */
	root: string;
	/** The store's directory, shortened. */
	where: string;
	/**
	 * The home directory a displayed path is shortened against, so the page can say `~/…` where
	 * the transcript does.
	 *
	 * Handed down rather than read in the browser, which has no `homedir`.
	 */
	home: string;
}

/** What the server read before building one snapshot. */
export interface ViewInput {
	/**
	 * The page's own actor: the seat the snapshot is read as.
	 *
	 * The page is not a session that happens to be serving — it is a seat that outlives
	 * whichever session serves it — so this is the one identity the browser's roster is marked
	 * against, and the page shows no other.
	 */
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
	/** The home a displayed path is shortened against; absent reads as this machine's home. */
	home?: string;
	/** The bus's records, when the page could read them at all. */
	roster?: readonly RosterSession[];
	/**
	 * Mail waiting on this repository's bus, read without consuming it.
	 *
	 * Read by the caller because the bus directory is the caller's fact; absent reads as
	 * nothing waiting, which is what a machine with no bus has.
	 */
	waiting?: WaitingPage;
	/**
	 * The name the board's lead role answers to, from its config.
	 *
	 * Absent is a board that names no lead, so no row is marked: a page that guessed the
	 * serving session was the lead would point at the wrong row after a rename.
	 */
	lead?: string;
	/**
	 * The cards whose recorded plan is gone, from `artifact.ts`'s one stat.
	 *
	 * Supplied rather than computed here: resolving a plan path is the plan store's rule, and this
	 * module builds a frame from facts. Absent reads as none, which is the ordinary board.
	 */
	gonePlans?: ReadonlySet<string>;
	/** The board's WIP limits, so a head can say `n/limit`; absent reads as the defaults. */
	limits?: WipLimits;
}

/** Build the page's snapshot. */
export function buildView(input: ViewInput): BoardView {
	// One index for the whole snapshot: a card's lane and its blockers are read from the
	// same board, so a dependency and its dependent cannot be told two different stories.
	const index = indexOf(input.cards);
	const gone = input.gonePlans ?? new Set<string>();
	// The name a reader sees is the one the bus holds now: a card records the label its write
	// knew, and a rename moves the record rather than the card. Resolved here, before anything
	// groups or joins by it, so the lanes, the rollup, and the roster tell one story.
	const named = input.cards.map((card) => withLiveOwner(card, input.roster));
	// One mapped list feeds both halves of the snapshot: the rollup's groups carry the same
	// card the lane does, so a client reading `round.unassigned` is not handed a card
	// missing the facts every other card has.
	const cards = named.map((card) => viewCardOf(card, index, gone.has(card.id)));
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
	const teammates =
		input.roster === undefined ? undefined : teammatesOf(input.roster, reader.label, input.lead, input.now);
	// The states a waiting row wears come from the same roster the agent cards are drawn from,
	// so a handoff to a dead session cannot look like one to a live peer.
	const waiting = {
		...(input.waiting ?? { messages: [], dropped: 0 }),
	};
	const messages = waiting.messages.map((message) => ({
		...message,
		to: message.to.map((label) => {
			const state = presenceOf(input.roster, { label }, input.now);
			return state === undefined ? { label } : { label, state };
		}),
	}));
	// Before the signature, because one of its facts is the rollup's: `unwritten` is the one
	// membership the clock decides, and a frame that is never pushed leaves the queue short.
	const round = buildRound(cards, input.now);
	return {
		lanes,
		total: cards.length,
		round,
		...(teammates === undefined ? {} : { teammates }),
		waiting: { messages, dropped: waiting.dropped },
		activity: activityOf(cards),
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
			// A message landing, or one being read, moves no card: the queue is the tab's other half
			// and has to be able to push a frame of its own. The ids are enough — their order is the
			// queue's own, and a reader's mail file going away is the news.
			`|waiting:${messages.map((message) => message.id).join(",")}/${String(waiting.dropped)}` +
			`|skipped:${(input.skipped ?? []).map((entry) => `${entry.file}:${entry.why}`).join(",")}` +
			`|unwritten:${round.unwritten.map((card) => card.id).join(",")}` +
			// A plan file going away moves no card's revision, and the face says so: without this the
			// tab would keep a frame that still reads the plan as there.
			`|gone:${[...gone].sort().join(",")}`,
		repo: input.repo,
		root: input.root,
		where: input.where,
		// Always a string on the wire: the page cannot ask for a home, and a bundle that fell back
		// to `homedir` would throw in the browser.
		home: input.home ?? homedir(),
	};
}

/**
 * One card for the page: what it carries, plus what it acts on.
 *
 * The card is copied rather than annotated — the caller's cards are the store's, and a
 * derived field written onto one would outlive the read that made it.
 */
function viewCardOf(card: Card, index: ReadonlyMap<string, Card>, planGone: boolean): ViewCard {
	// The page draws these two as its own lines, and a reader has to know *which* card: the
	// lane alone is a state, and the title is the card. The transcript asks for no titles —
	// a refusal is a row, and the sentence is the point there.
	const waits = lanesText(blockersOf(card, index), { titles: true });
	const dependents = lanesText(openDependentsOf(card.id, index), { titles: true });
	const since = laneSince(card);
	return {
		...card,
		priority: priorityOf(card),
		...(waits === "" ? {} : { waits }),
		...(dependents === "" ? {} : { dependents }),
		...(since === undefined ? {} : { since }),
		...(planGone ? { planGone: true as const } : {}),
	};
}

/** The roster as the page shows it, ordered so a repaint never reorders it. */
function teammatesOf(
	roster: readonly RosterSession[],
	meLabel: string,
	lead: string | undefined,
	now: number,
): ViewTeammate[] {
	return roster
		.map((session) => {
			// Once, because the rule can cost a process: a quiet record with a start token is
			// settled by asking the host about that pid.
			const state = rosterStateOf(session, now);
			return {
				label: session.label,
				state,
				// A turn is believed only while the session that wrote it is still there: a crash
				// mid-run leaves the stamp, and a session whose heartbeat has aged is not at work.
				...(state === "live" && session.turnAt !== undefined ? { working: true as const } : {}),
				...(lead !== undefined && sameLabel(session.label, lead) ? { lead: true as const } : {}),
				seen: session.lastSeen,
				mail: session.mail,
				// A record that does not say is not a promise either way, so the fact is left out
				// rather than drawn as "not listening".
				...(session.watching === undefined ? {} : { listening: session.watching.armed }),
				you: sameLabel(session.label, meLabel),
			};
		})
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** What a frame must know about the roster; `seen` is left out on purpose. */
function rosterSignature(teammates: readonly ViewTeammate[] | undefined): string {
	if (teammates === undefined) return "";
	return (
		"|" +
		teammates
			.map(
				(teammate) =>
					`${teammate.label}:${teammate.state}:${teammate.mail}:${teammate.listening}:${String(teammate.working)}:${String(teammate.lead)}`,
			)
			.join(",")
	);
}

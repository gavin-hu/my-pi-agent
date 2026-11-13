/**
 * The rollup: the lead's view of a board, computed from the cards alone.
 *
 * This is what `board list --round` returns and what the page's Team tab draws, so
 * the two cannot disagree about who holds what. It deliberately reads nothing but
 * the cards: a session's liveness is `session status`'s answer, and the board has
 * to work when `session-bus` is not loaded. `unwritten` therefore means what a card can
 * know — nobody has written its file in half an hour — not that its owner's process is
 * gone, and not that a session is free: a session holding nothing is the roster's `idle`,
 * which is a bus fact this rollup never reads.
 *
 * The groups overlap on purpose. A `plan` card with no contract and no writes for half
 * an hour is both `unplanned` and, once it is executing, `unwritten`; hiding it in one of
 * the two would lose half the reason a lead should look at it. The same holds for
 * `unreviewed` and `unwritten`: one says the lead owes a look, the other that nobody has
 * written the card.
 *
 * It also owns the gate each of its three queues is about — the contract, the approval, the
 * spot-check — because a group and the word for it are one fact: the transcript's rows and
 * `board list`'s line ask here for the word they print, rather than deciding it from `planPath`
 * a second time.
 *
 * Pure: no I/O and no clock of its own.
 */

import { type Card, dependsOf } from "./card.ts";
import { contractApproved, missingContractFields } from "./contract.ts";
import { currentReview } from "./lead.ts";
import { type Gate } from "./tone.ts";

/** How long an `execute` card may go unwritten before the rollup calls it that. */
export const UNWRITTEN_MS = 30 * 60 * 1_000;

/**
 * What a card still owes in the lane it is in, or `undefined` when it owes no route gate.
 *
 * This was two rules: the round read `planPath` plus a complete contract while the transcript's
 * row read `planPath` alone, so a card with a plan file and half a contract printed "planned" in
 * a row and was counted `unplanned` here. Only the two lanes a card is worked in answer — the
 * pool owes a plan nobody has started and a blocked card owes a decision, and both are their own
 * groups — and the spot-check asked about is `currentReview`'s, the one that speaks for the
 * execution the card is in now.
 */
export function gateOf(card: Card): Gate | undefined {
	if (card.lane === "plan") {
		// A complete contract still needs a file to execute against: a card planned before the
		// artifact rule has neither, and what it owes is the contract itself, not a signature.
		if (missingContractFields(card.contract).length > 0 || card.planPath === undefined) return "contract";
		return contractApproved(card.contract) ? undefined : "approval";
	}
	if (card.lane === "execute") return currentReview(card) === undefined ? "review" : undefined;
	return undefined;
}

/**
 * One owner, the live cards it holds, and the ones it finished.
 *
 * `T` is what the caller handed in: the rollup never builds a card, so a snapshot whose
 * cards carry derived facts hands them back on the same terms it received them.
 */
export interface RoundGroup<T extends Card = Card> {
	label: string;
	cards: T[];
	/** This owner's finished cards: history, kept so a teammate who is done is not erased. */
	done: T[];
}

/** The lead's rollup of one board. */
export interface RoundSummary<T extends Card = Card> {
	/** Every owner the board names, ordered by label, with its live cards and the ones it finished. */
	owners: RoundGroup<T>[];
	/** `backlog` cards: nobody has taken them yet. */
	unassigned: T[];
	/**
	 * `plan` cards whose contract is still missing a line, or whose plan was never recorded:
	 * work started before it was agreed, and either one refuses `execute`.
	 */
	unplanned: T[];
	/** `plan` cards whose contract is complete and nobody has approved: the lead's queue. */
	unapproved: T[];
	/**
	 * `execute` cards nobody has spot-checked: the lead's other signature, and owed from the
	 * moment a card enters the lane rather than from a clock.
	 *
	 * A card in `execute` is work the lead must look at before it may be finished, so this is
	 * the whole lane, in flight included — the board cannot tell finished work from work in
	 * progress, and a card that says nothing until it has sat untouched for half an hour is a
	 * card the lead hears about late. The sign asked about is `execute`'s own: a spot-check a
	 * reclaim carried back into the pool speaks for the execution it was made in, not this one.
	 */
	unreviewed: T[];
	/** `blocked` cards, and the note that says why. */
	blocked: T[];
	/** `execute` cards with no write for {@link UNWRITTEN_MS}: possibly a dead owner. */
	unwritten: T[];
	/** Finished cards, in the board's own order — priority, then age — kept as history. */
	done: T[];
	/**
	 * The finished cards a sweep may fold away: the ones no open card still waits on.
	 *
	 * Archiving is one way — nothing un-archives — so a finished card an open card names in
	 * `dependsOn` stays on the board: the link survives the archive but the record loses the
	 * card it names, and `#7 waits on #2` would point at a card no read of the board opens.
	 */
	archivable: T[];
}

/**
 * The rollup of `cards` at `now`.
 *
 * `cards` holds the unfinished cards only: a finished one is also in `done` and
 * counting it twice would make the tallies disagree with the lanes. A finished card
 * still names its owner, in the group's `done`, because an owner whose last card is
 * done has not left the board — dropping the group erased a teammate the round had
 * just finished. Two owners
 * whose labels differ only by case are one owner — a name is case-insensitive when
 * it is a send target, so it is here too — and the first spelling seen is kept.
 */
export function buildRound<T extends Card = Card>(cards: readonly T[], now: number): RoundSummary<T> {
	const groups = new Map<string, RoundGroup<T>>();
	const unassigned: T[] = [];
	const unplanned: T[] = [];
	const unapproved: T[] = [];
	const unreviewed: T[] = [];
	const blocked: T[] = [];
	const unwritten: T[] = [];
	const done: T[] = [];

	for (const card of cards) {
		// The pool is what nobody holds, and the two lanes a lead watches are the two a card
		// is worked in: a plan with a contract still missing is work started before it was
		// agreed, and an execute nothing has touched is work that may have stopped.
		if (card.lane === "backlog") unassigned.push(card);
		if (card.lane === "done") done.push(card);
		if (card.lane === "blocked") blocked.push(card);
		// The route gate a card owes, from the one rule the transcript's rows read too: a contract
		// still being written, the approval of one nobody has read, or the spot-check of the
		// execution the card is in now. This grouping used to be a second opinion.
		const gate = gateOf(card);
		if (gate === "contract") unplanned.push(card);
		else if (gate === "approval") unapproved.push(card);
		else if (gate === "review") unreviewed.push(card);
		if (card.lane === "execute" && now - card.updatedAt >= UNWRITTEN_MS) unwritten.push(card);

		if (card.owner === undefined) continue;
		const key = card.owner.label.toLowerCase();
		const group = groups.get(key) ?? { label: card.owner.label, cards: [], done: [] };
		if (card.lane === "done") group.done.push(card);
		else group.cards.push(card);
		groups.set(key, group);
	}

	return {
		owners: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)),
		unassigned,
		unplanned,
		unapproved,
		unreviewed,
		blocked,
		unwritten,
		done,
		archivable: archivableOf(cards, done),
	};
}

/**
 * The finished cards nothing open still waits on.
 *
 * The whole board is read, not just the finished cards: a `done` card that another finished
 * card names is nobody's blocker, and a `done` card an open one names is what a sweep must
 * leave where it is.
 */
export function archivableOf<T extends Card = Card>(cards: readonly T[], done: readonly T[]): T[] {
	const waited = new Set<string>();
	for (const card of cards) {
		if (card.lane === "done") continue;
		for (const id of dependsOf(card)) waited.add(id);
	}
	return done.filter((card) => !waited.has(card.id));
}

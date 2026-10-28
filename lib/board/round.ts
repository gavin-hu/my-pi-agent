/**
 * The rollup: the lead's view of a board, computed from the cards alone.
 *
 * This is what `board list --round` returns and what the page's Team tab draws, so
 * the two cannot disagree about who holds what. It deliberately reads nothing but
 * the cards: a session's liveness is `session status`'s answer, and the board has
 * to work when `session-bus` is not loaded. `idle` therefore means what a card can
 * know — nobody has touched it in half an hour — not that its owner's process is
 * gone.
 *
 * The groups overlap on purpose. A `plan` card with no contract and no touch for half
 * an hour is both `unplanned` and, once it is executing, `idle`; hiding it in one of the
 * two would lose half the reason a lead should look at it.
 *
 * Pure: no I/O and no clock of its own.
 */

import type { Card } from "./card.ts";
import { contractApproved, missingContractFields } from "./contract.ts";

/** How long an `execute` card may go untouched before the rollup calls it idle. */
export const IDLE_MS = 30 * 60 * 1_000;

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
	/** Every owner with at least one unfinished card, ordered by label. */
	owners: RoundGroup<T>[];
	/** `backlog` cards: nobody has taken them yet. */
	unassigned: T[];
	/** `plan` cards whose contract is still missing a line: work started before it was agreed. */
	unplanned: T[];
	/** `plan` cards whose contract is complete and nobody has approved: the lead's queue. */
	unapproved: T[];
	/** `blocked` cards, and the note that says why. */
	blocked: T[];
	/** `execute` cards untouched for {@link IDLE_MS}: possibly a dead owner. */
	idle: T[];
	/** Finished cards, oldest first, kept as history. */
	done: T[];
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
	const blocked: T[] = [];
	const idle: T[] = [];
	const done: T[] = [];

	for (const card of cards) {
		// The pool is what nobody holds, and the two lanes a lead watches are the two a card
		// is worked in: a plan with a contract still missing is work started before it was
		// agreed, and an execute nothing has touched is work that may have stopped.
		if (card.lane === "backlog") unassigned.push(card);
		if (card.lane === "done") done.push(card);
		if (card.lane === "blocked") blocked.push(card);
		if (card.lane === "plan") {
			if (missingContractFields(card.contract).length > 0) unplanned.push(card);
			else if (!contractApproved(card.contract)) unapproved.push(card);
		}
		if (card.lane === "execute" && now - card.updatedAt >= IDLE_MS) idle.push(card);

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
		blocked,
		idle,
		done,
	};
}

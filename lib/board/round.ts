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
 * The groups overlap on purpose. A `doing` card with no plan and no touch for an
 * hour is both `unplanned` and `idle`, and hiding it in one of the two would lose
 * half the reason a lead should look at it.
 *
 * Pure: no I/O and no clock of its own.
 */

import type { Card } from "./card.ts";

/** How long a `doing` card may go untouched before the rollup calls it idle. */
export const IDLE_MS = 30 * 60 * 1_000;

/** One owner, the live cards it holds, and the ones it finished. */
export interface RoundGroup {
	label: string;
	cards: Card[];
	/** This owner's finished cards: history, kept so a teammate who is done is not erased. */
	done: Card[];
}

/** The lead's rollup of one board. */
export interface RoundSummary {
	/** Every owner with at least one unfinished card, ordered by label. */
	owners: RoundGroup[];
	/** `todo` cards: nobody has taken them yet. */
	unassigned: Card[];
	/** `doing` cards with no plan recorded: work started before it was planned. */
	unplanned: Card[];
	/** `blocked` cards, and the note that says why. */
	blocked: Card[];
	/** `doing` cards untouched for {@link IDLE_MS}: possibly a dead owner. */
	idle: Card[];
	/** Finished cards, oldest first, kept as history. */
	done: Card[];
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
export function buildRound(cards: readonly Card[], now: number): RoundSummary {
	const groups = new Map<string, RoundGroup>();
	const unassigned: Card[] = [];
	const unplanned: Card[] = [];
	const blocked: Card[] = [];
	const idle: Card[] = [];
	const done: Card[] = [];

	for (const card of cards) {
		if (card.status === "todo") unassigned.push(card);
		if (card.status === "done") done.push(card);
		if (card.status === "blocked") blocked.push(card);
		if (card.status === "doing" && card.plan === undefined) unplanned.push(card);
		if (card.status === "doing" && now - card.updatedAt >= IDLE_MS) idle.push(card);

		if (card.owner === undefined) continue;
		const key = card.owner.label.toLowerCase();
		const group = groups.get(key) ?? { label: card.owner.label, cards: [], done: [] };
		if (card.status === "done") group.done.push(card);
		else group.cards.push(card);
		groups.set(key, group);
	}

	return {
		owners: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)),
		unassigned,
		unplanned,
		blocked,
		idle,
		done,
	};
}

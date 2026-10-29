/**
 * The lead's rollup, as the lines a reader gets.
 *
 * Two surfaces want the same sentences: `board`'s tool returns them, because the model's
 * next decision is taken from the counts and the ids, and `team`'s `/team` prints them,
 * because a lead in a terminal should not have to open a browser to see what needs a
 * decision. One text, so the two cannot describe one board differently.
 *
 * It reads the cards, the round, and — when a caller has one — the roster, and never a clock
 * or a store: the group lines are pure and a caller supplies what it already read. The roster
 * is what lets an owner who is only history be stated once instead of once per label, and it
 * is optional because a board works with `session-bus` unloaded.
 */

import { type Card, cardRef } from "./card.ts";
import type { RoundSummary } from "./round.ts";

/** What the fold needs of a roster row: the page's `ViewTeammate` and the bus's record both answer it. */
export interface RosterLabel {
	label: string;
}

/**
 * The rollup: a headline of what a lead decides on, then one line per group.
 *
 * Groups name their cards by id and state, because the ids are what the next action
 * takes, and an empty group is left out rather than drawn empty.
 *
 * `roster` decides which owners are only history: the ones a bus has no record of and that
 * hold nothing are stated in one line, because a label that ever claimed a card stays an
 * owner for good. Without a roster nothing is called absent, which is the honest answer for
 * a machine where the bus has recorded nobody.
 */
export function formatRound(cards: readonly Card[], round: RoundSummary, roster?: readonly RosterLabel[]): string {
	const owners = round.owners.length;
	const headline = [
		plural(owners, "owner"),
		plural(cards.length, "feature"),
		`${round.unassigned.length} unassigned`,
		`${round.unplanned.length} unplanned`,
		`${round.unapproved.length} awaiting approval`,
		`${round.blocked.length} blocked`,
		`${round.idle.length} idle`,
		`${round.done.length} done`,
	].join(" · ");
	const lines = [headline];
	// The history is counted as it goes, so its one line can follow the owner lines and the
	// queue can start where a lead actually decides something.
	let history = 0;
	let finished = 0;
	for (const group of round.owners) {
		if (isHistoryOwner(group.label, group.cards.length, roster)) {
			history += 1;
			finished += group.done.length;
			continue;
		}
		// An owner who finished everything is still listed, with what it finished: the
		// count says which kind of work is left, and an empty list is a legitimate answer.
		const counts =
			group.done.length > 0 ? `${group.cards.length} live, ${group.done.length} done` : `${group.cards.length}`;
		const listed = group.cards.map((card) => brief(card)).join(", ");
		lines.push(listed === "" ? `${group.label} (${counts})` : `${group.label} (${counts}): ${listed}`);
	}
	if (history > 0) lines.push(historyLine(history, finished));
	lines.push(...group("unassigned", round.unassigned));
	lines.push(...group("unplanned", round.unplanned));
	lines.push(...group("unapproved", round.unapproved));
	lines.push(...group("blocked", round.blocked, true));
	lines.push(...group("idle", round.idle));
	lines.push(...group("done", round.done));
	return lines.join("\n");
}

/**
 * `1 owner`, `2 owners`.
 *
 * Written as concatenation rather than a template, because the page's bundle carries
 * this function's *source*: a backtick or an interpolation in it would end the string it
 * is spliced into. `round-text.test.ts` pins both, and `PLURAL_JS` is how it crosses.
 */
export function plural(count: number, noun: string): string {
	return count + " " + noun + (count === 1 ? "" : "s");
}

/** The same body, as the browser receives it: one wording for `1 card`, not two. */
export const PLURAL_JS = String(plural);

/**
 * Whether an owner is only history: the bus has no record of it, and it holds nothing.
 *
 * The Team tab and this text answer one question — which owners a board still has to show —
 * so they ask it here. A label that ever claimed a card stays an owner for good, which is why
 * the set only grows and why it is stated once.
 *
 * `roster` absent is "no bus here", not "no record": a machine that has recorded nobody
 * cannot call an owner absent, and the page says `—` for the same reason.
 */
export function isHistoryOwner(label: string, held: number, roster: readonly RosterLabel[] | undefined): boolean {
	if (roster === undefined || held > 0) return false;
	const key = label.toLowerCase();
	for (const session of roster) {
		if (session.label.toLowerCase() === key) return false;
	}
	return true;
}

/** The same body, as the browser receives it. */
export const HISTORY_OWNER_JS = String(isHistoryOwner);

/**
 * The one line the fold prints: `18 owners with no record · 71 done`.
 *
 * The page's history row and this line are one sentence, so the count of owners and the work
 * they finished read the same on both surfaces.
 */
export function historyLine(owners: number, done: number): string {
	return plural(owners, "owner") + " with no record · " + done + " done";
}

/** The same body, as the browser receives it: it calls `plural`, which the fragment holds. */
export const HISTORY_LINE_JS = String(historyLine);

/** `#4 execute planned`, the brief a rollup group needs. */
function brief(card: Card): string {
	// Only the two lanes a card is worked in say whether it was planned first: the pool has
	// no plan yet, and a finished card is history.
	const planned =
		card.lane === "plan" || card.lane === "execute" ? (card.planPath === undefined ? " unplanned" : " planned") : "";
	return `${cardRef(card.id)} ${card.lane}${planned}`;
}

/** One rollup group, or nothing when it is empty. */
function group(label: string, cards: readonly Card[], withReason = false): string[] {
	if (cards.length === 0) return [];
	const items = cards.map((card) => (withReason ? blockedBrief(card) : brief(card)));
	return [`${label} (${cards.length}): ${items.join(", ")}`];
}

/** A blocked card names the note that explains it, if there is one. */
function blockedBrief(card: Card): string {
	const last = card.notes.at(-1);
	return `${brief(card)}${last === undefined ? "" : ` — ${last.text}`}`;
}

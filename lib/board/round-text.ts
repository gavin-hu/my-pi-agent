/**
 * The lead's rollup, as the lines a reader gets.
 *
 * Two surfaces want the same sentences: `board`'s tool returns them, because the model's
 * next decision is taken from the counts and the ids, and `team`'s `/team` prints them,
 * because a lead in a terminal should not have to open a browser to see what needs a
 * decision. One text, so the two cannot describe one board differently.
 *
 * It reads the cards and the round and nothing else — no clock, no roster, no store — so
 * `plural` and the group lines are pure and a caller supplies what it already read.
 */

import { type Card, cardRef } from "./card.ts";
import type { RoundSummary } from "./round.ts";

/**
 * The rollup: a headline of what a lead decides on, then one line per group.
 *
 * Groups name their cards by id and state, because the ids are what the next action
 * takes, and an empty group is left out rather than drawn empty.
 */
export function formatRound(cards: readonly Card[], round: RoundSummary): string {
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
	for (const group of round.owners) {
		// An owner who finished everything is still listed, with what it finished: the
		// count says which kind of work is left, and an empty list is a legitimate answer.
		const counts =
			group.done.length > 0 ? `${group.cards.length} live, ${group.done.length} done` : `${group.cards.length}`;
		const listed = group.cards.map((card) => brief(card)).join(", ");
		lines.push(listed === "" ? `${group.label} (${counts})` : `${group.label} (${counts}): ${listed}`);
	}
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

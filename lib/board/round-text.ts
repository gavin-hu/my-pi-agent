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
 *
 * It also carries what a session is holding, because both surfaces that name one say so: the
 * terminal's presence line prints the pair, and the page's teammate row prints its second
 * half beside the label. And it carries the name itself, because a label is a word a record
 * can move: {@link withLiveOwner} resolves a card's owner through the roster's record for its
 * id, so a session that renamed after the write is still one name wherever a card is read.
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
		`${round.unreviewed.length} awaiting review`,
		`${round.blocked.length} blocked`,
		`${round.unwritten.length} unwritten`,
		// The history is the one count a reader can act on without opening a card: a finished
		// card an open one still waits on stays, so `archivable` is what a sweep would take. It
		// rides on the count it qualifies, and says nothing at all when there is nothing to sweep.
		`${round.done.length} done${byInstruction(cards)}${round.archivable.length > 0 ? `, ${round.archivable.length} archivable` : ""}`,
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
	lines.push(...group("unreviewed", round.unreviewed));
	lines.push(...group("blocked", round.blocked, true));
	lines.push(...group("unwritten", round.unwritten));
	lines.push(...group("done", round.done));
	const dropped = droppedHistory(cards);
	if (dropped !== "") lines.push(dropped);
	return lines.join("\n");
}

/**
 * How many finished cards were closed by instruction, as a clause on the done count.
 *
 * The cards are already in hand, so this is a rule over them rather than a field on
 * `RoundSummary`: the round counts lanes, and how a close was signed is the card's own fact.
 * Empty when nobody overrode a gate, which is every board that never needed to.
 */
function byInstruction(cards: readonly Card[]): string {
	const count = cards.filter((card) => card.lane === "done" && card.review?.byInstruction !== undefined).length;
	return count === 0 ? "" : `, ${count} by instruction`;
}

/**
 * The cards that lost text to the note or lane cap, in one line, or the empty string.
 *
 * A cap is a decision that history is worth less than a bounded file, and it is only honest
 * while a reader is told: the count lives on the card, which is a place nobody looks until
 * they have already decided to open it.
 */
function droppedHistory(cards: readonly Card[]): string {
	const lost: string[] = [];
	for (const card of cards) {
		const parts: string[] = [];
		const notes = card.notesDropped;
		if (notes > 0) parts.push(plural(notes, "note"));
		const lanes = card.logDropped ?? 0;
		if (lanes > 0) parts.push(`${lanes} ${lanes === 1 ? "lane" : "lanes"}`);
		if (parts.length > 0) lost.push(`${cardRef(card.id)} (${parts.join(", ")})`);
	}
	if (lost.length === 0) return "";
	return `dropped history: ${lost.join(", ")} — the card keeps the count, not the text`;
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

/**
 * What a session is holding, in one phrase: `#162 plan`, `#162 plan +2`, or `idle`.
 *
 * The first card is named because an id and a lane are what the next verb takes, and the rest
 * are counted rather than listed: a roster row is one line, and a session holding four cards
 * should not push the other teammates off it. `idle` is the holding that is no card — the
 * fact a presence line could not say before, and the one a lead reads to tell "here and busy"
 * from "here and free".
 *
 * Written as concatenation, like `plural`, and with the `#` inlined rather than taken from
 * `cardRef`: the page's bundle carries this body as `HOLDING_OF_JS`, and a template or a call
 * it could not resolve would be a served script that does not run.
 */
export function holdingOf(cards: readonly Card[]): string {
	const [first] = cards;
	if (first === undefined) return "idle";
	const brief = "#" + first.id + " " + first.lane;
	return cards.length === 1 ? brief : brief + " +" + (cards.length - 1);
}

/** The same body, as the browser receives it. */
export const HOLDING_OF_JS = String(holdingOf);

/**
 * The pair: `helen — #162 plan`.
 *
 * The label and its holding are one sentence, so a reader never matches a name in one column
 * to a count in another. The page draws the label in its own element and prints
 * {@link holdingOf} beside it, which reads the same way and keeps the name a heading.
 */
export function holdingLine(label: string, cards: readonly Card[]): string {
	return label + " — " + holdingOf(cards);
}

/** What naming an owner reads of a roster row: the id a card records, and the label it answers by. */
export interface RosterName {
	id: string;
	label: string;
}

/**
 * The label a card's owner answers to now, or the one the card kept when no record names its id.
 *
 * A card records the name its holder answered to when the write was made, and that name can stop
 * being true: `/team join <label>`, `/session join`, and a rename in Pi all move the bus record and
 * touch no card. The id cannot move — it is what `holds` compares first, and what a sign is
 * addressed by — so the id is the identity and the label is the word a reader sees.
 */
export function liveLabelOf(owner: { id?: string; label: string }, roster?: readonly RosterName[]): string {
	if (roster === undefined || owner.id === undefined) return owner.label;
	const record = roster.find((session) => session.id === owner.id);
	return record === undefined ? owner.label : record.label;
}

/**
 * `card` as a reader should see it: its owner named by the roster, and the very same card when
 * that name already agrees — identity rather than a copy in the ordinary case, because a listing
 * maps every card it shows and almost none of them were renamed.
 *
 * Deliberately not a write: a rename would rewrite every card a session holds, race whoever else
 * is writing, and still never reach a finished one. The card file stays the record of what the
 * write knew; the reader's copy carries the name.
 */
export function withLiveOwner<T extends Card>(card: T, roster?: readonly RosterName[]): T {
	const owner = card.owner;
	if (owner === undefined) return card;
	const label = liveLabelOf(owner, roster);
	return label === owner.label ? card : { ...card, owner: { ...owner, label } };
}

/**
 * `#4 execute`, the brief a rollup group needs.
 *
 * The lane only: the group's heading is what says which gate the card owes — and it says it in
 * the same words the transcript's row prints, because both read `gateOf`.
 */
function brief(card: Card): string {
	return `${cardRef(card.id)} ${card.lane}`;
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

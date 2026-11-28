/**
 * The round as text: what `/team` prints, and what `/team who` lists.
 *
 * Pure over `(cards, now, roster)`, and that is the claim a reader can check from this header
 * alone: nothing here imports a store, asks the bus, takes a `pi`, or composes a notice — so every
 * line is a fact about what the board and the roster already say, and a case can hold it without a
 * temp directory or a mount.
 *
 * `lib/workflow/round-text.ts` owns the rollup's own lines; this module owns the notify's cap, the
 * presence listing, and the reclaim door `/team` adds to them. `commands.ts` reaches it with an
 * `import()` inside the handler, so the registration graph never pays for it.
 */

import { plural } from "../../lib/format.ts";
import { labelKey } from "../../lib/session-label.ts";
import { presenceOf, type RosterSession, rosterStateOf } from "../../lib/session-roster.ts";
import { type Card, cardRef } from "../../lib/workflow/card.ts";
import { buildRound, type RoundSummary } from "../../lib/workflow/round.ts";
import { formatRound, holdingLine, withLiveOwner } from "../../lib/workflow/round-text.ts";

/**
 * How many of the round's own lines print before it says how many it left out.
 *
 * The work a dead owner left behind and the closing count print on top of it: those are the reason
 * a lead reads the round, and cutting them to hold a number would be the wrong trade. The elision
 * counts the rollup alone, so "… N more" is a count a reader can act on, and it names the surface
 * that draws the rest. The count is the part of the round a reader can ask for whole: `/team who`.
 */
export const MAX_ROUND_LINES = 10;

/**
 * The round as the lines a lead reads: the rollup, then a count of who is live.
 *
 * Capped, because a notify is a message and not a screen: past its limit the round says how many
 * lines it left out and which surface draws the rest, instead of pushing the session up the screen.
 * The tail is a count and a door, not the paragraph that named every session twice: the rows are
 * `/team who`'s.
 */
export function roundText(cards: readonly Card[], now: number, roster?: readonly RosterSession[]): string {
	if (cards.length === 0) return "team: nothing to report — the board is empty";
	// The name an owner is shown by is the one the bus holds now, resolved before anything groups
	// or compares labels: a rename moves the record and no card, and the rollup, the stalled lines,
	// and the presence line all speak of owners by their label.
	const named = cards.map((card) => withLiveOwner(card, roster));
	const round = buildRound(named, now);
	// The cap covers the rollup: what a dead owner left, and who is here at all, follow it whole.
	const lines = formatRound(named, round, roster).split("\n");
	const shown = lines.slice(0, MAX_ROUND_LINES);
	if (lines.length > MAX_ROUND_LINES) {
		shown.push(`… ${plural(lines.length - MAX_ROUND_LINES, "line")} more — /board draws the whole round`);
	}
	for (const line of stalledLines(named, roster, now)) shown.push(line);
	// The tail is the count a reader can ask for whole as `/team who`, so both read one grouping:
	// `presenceGroups` is the only place this module asks `rosterStateOf`.
	const who =
		roster === undefined || roster.length === 0
			? undefined
			: presenceTail(presenceGroups(round, roster, now), roster.length);
	if (who !== undefined) shown.push(who);
	return shown.join("\n");
}

/**
 * The four states, in the order they print, with the word each one heads.
 *
 * `who` heads its sections with these words and `who <label>` answers with the one its row belongs
 * to, so the word a reader meets in a listing and in a single answer cannot drift apart.
 */
const SECTIONS: ReadonlyArray<{ state: keyof WhoIsHere; head: string }> = [
	{ state: "live", head: "live" },
	{ state: "quiet", head: "quiet" },
	{ state: "absent", head: "not on the bus" },
	{ state: "gone", head: "gone" },
];

/**
 * `/team who [<label>]`: the same grouping as rows, uncapped and one session per row.
 *
 * `/team` is a notify whose cap decides what a reader sees, and a paragraph that names a session
 * under its state and again under `not listening` is the shape that answers this badly. Rows answer
 * it — who is here, and what each is holding — so no line is elided and every state prints,
 * `- none` included: a group a reader has to infer from its absence is the one that gets forgotten.
 * A label asks the same grouping about one session, an owner the bus has no record of included.
 */
export function whoText(cards: readonly Card[], now: number, roster?: readonly RosterSession[], label = ""): string {
	// A bus directory that does not exist is a fact, not an empty board: nobody has joined, so there
	// is nobody to list, and a word that printed nothing would look broken.
	if (roster === undefined) return "team: no session bus on this repository — nobody has joined";
	const here = whoIsHere(cards, now, roster);
	if (label !== "") {
		const asked = labelKey(label);
		for (const { state, head } of SECTIONS) {
			const row = here[state].find((candidate) => labelKey(candidate.label) === asked);
			if (row !== undefined) return `team: ${row.line} · ${head}${row.silent ? " · not listening" : ""}`;
		}
		return `team: no session or owner named "${label}" — /team who lists who is here`;
	}
	return [
		`team: ${plural(roster.length, "session")} on the bus`,
		...SECTIONS.flatMap(({ state, head }) => section(head, here[state])),
	].join("\n");
}

/** One state's rows: its head counts, and an empty group says so rather than vanishing. */
function section(label: string, rows: readonly PresenceRow[]): string[] {
	const head = `${label} (${rows.length})`;
	if (rows.length === 0) return [head, "- none"];
	return [head, ...rows.map((row) => `- ${row.line}${row.silent ? " · not listening" : ""}`)];
}

/**
 * The cards a lead can take back, as the line that says who from.
 *
 * One line per owner whose record says it has stopped, naming every unfinished card it holds —
 * including one that waits on another, since the board's dependency rule refuses a claim and a move
 * but `reclaim` is neither. Quiet is here because the rule lets a peer take a quiet owner's card.
 * An owner the bus has no record of is not: a live session that never joined writes no record
 * either, so the presence line states that as a fact instead of offering the verb.
 *
 * The verb the line prints is `board`'s, and it names it: `/team` writes nothing, and a bare
 * `reclaim` here would send a lead to a tool that no longer has one.
 */
function stalledLines(cards: readonly Card[], roster: readonly RosterSession[] | undefined, now: number): string[] {
	if (roster === undefined) return [];
	const byOwner = new Map<string, { label: string; state: "quiet" | "gone"; refs: string[] }>();
	for (const card of cards) {
		if (card.owner === undefined || card.lane === "done") continue;
		const state = presenceOf(roster, card.owner, now);
		if (state !== "quiet" && state !== "gone") continue;
		const key = labelKey(card.owner.label);
		const entry = byOwner.get(key) ?? { label: card.owner.label, state, refs: [] };
		entry.refs.push(cardRef(card.id));
		byOwner.set(key, entry);
	}
	return [...byOwner.values()].map(({ label, state, refs }) => {
		const why = state === "gone" ? "is not running" : "has gone quiet";
		return `board reclaim ${refs.join(", ")} — ${label} ${why}`;
	});
}

/** One session as both listings print it. */
export interface PresenceRow {
	label: string;
	/** `billing-core — #4 execute`, from `holdingLine`: the phrase both words print. */
	line: string;
	/** Its record says `watching.armed === false`, so mail waits for its next turn. */
	silent: boolean;
}

/** Who is here, grouped by what a lead does about it. */
export interface WhoIsHere {
	live: PresenceRow[];
	quiet: PresenceRow[];
	gone: PresenceRow[];
	/** Owners the board names, the bus has no record of, holding live cards. */
	absent: PresenceRow[];
}

/**
 * Who is here, from the round and the bus: the one grouping both words print.
 *
 * The owner groups are where the board already decided which label a card belongs to, so a
 * session's holding is the one its rollup line counted. `rosterStateOf` is asked here and nowhere
 * else in this module, so the tail and the listing cannot read one record two ways.
 */
function presenceGroups(round: RoundSummary, roster: readonly RosterSession[], now: number): WhoIsHere {
	const held = new Map(round.owners.map((group) => [labelKey(group.label), group.cards] as const));
	const row = (label: string, silent = false): PresenceRow => ({
		label,
		line: holdingLine(label, held.get(labelKey(label)) ?? []),
		silent,
	});
	const here: WhoIsHere = { live: [], quiet: [], gone: [], absent: [] };
	const recorded = new Set(roster.map((record) => labelKey(record.label)));
	for (const record of roster) {
		const state = rosterStateOf(record, now);
		if (state === "gone") here.gone.push(row(record.label));
		else if (state === "live") here.live.push(row(record.label, record.watching?.armed === false));
		else here.quiet.push(row(record.label));
	}
	// The owners the bus holds no record of, as the board knows them: only the ones holding work are
	// worth a row, because an owner holding nothing is history and `formatRound` folds it.
	here.absent = round.owners
		.filter((group) => group.cards.length > 0 && !recorded.has(labelKey(group.label)))
		.map((group) => row(group.label));
	return here;
}

/**
 * The same grouping, from the cards alone: the door `/team who` and this module's suite read.
 *
 * One body with {@link presenceGroups}, so a case that compares the two surfaces against it is
 * comparing both to the grouping they actually print rather than to a restatement of its names.
 */
export function whoIsHere(cards: readonly Card[], now: number, roster: readonly RosterSession[]): WhoIsHere {
	const named = cards.map((card) => withLiveOwner(card, roster));
	return presenceGroups(buildRound(named, now), roster, now);
}

/**
 * The line `/team` closes with: `2 of 4 sessions live — /team who lists them`.
 *
 * A count and a door rather than a sentence per state. The old paragraph repeated a session under
 * its state and again under `not listening:` and wrapped into a wall on any narrow terminal, and
 * the part of it a lead acted on — `board reclaim …` for a dead owner's cards — already prints
 * above this line. What is left is the one number a lead cannot read elsewhere: how much of the
 * bus is live, which is who a card can be handed to now.
 */
function presenceTail(here: WhoIsHere, total: number): string {
	return `${here.live.length} of ${plural(total, "session")} live — /team who lists them`;
}

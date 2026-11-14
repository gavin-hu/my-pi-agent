/**
 * `/team` — the lead's round, printed.
 *
 * The Team tab is the same round with a mouse; a lead reading a TUI should not have to
 * open a browser to see what needs a decision, so the command prints the rollup the
 * tool returns, the work a dead owner left behind, and one line saying who is live. It
 * reads the cards and the bus's records and writes nothing: acting on the round is
 * `team`'s tool (`assign`, `offer`, `ask`) or `board`'s own verbs.
 *
 * `/team join` lives here too, and stays in this module: the entry's registration budget counts the
 * modules it loads, so a door of its own would cost a start for one command's words.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { addTeammate, type AddTeammateResult } from "../../lib/board/config.ts";
import { type Card, cardRef } from "../../lib/board/card.ts";
import { buildRound, type RoundSummary } from "../../lib/board/round.ts";
import { formatRound, holdingLine, LEAD_ROUND, plural, withLiveOwner } from "../../lib/board/round-text.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import { createTeamJoin, type JoinResult, type TeamJoin, type TeamJoinInput } from "../../lib/session-tool.ts";
import { type RosterSession, presenceOf, rosterStateOf } from "../../lib/session-roster.ts";
import { isTeammate, labelKey, sessionNameOf } from "../../lib/session-label.ts";
import { formatJoined, formatNotJoined, joinNote } from "./format.ts";

/** The command's name, which is also the word a user types. */
export const TEAM_COMMAND = "team";

/** The words the command accepts besides the round itself. */
export const TEAM_WORDS = ["join"] as const;

/**
 * How many of the round's own lines print before it says how many it left out.
 *
 * The work a dead owner left behind and the presence line print on top of it: those are the
 * reason a lead reads the round, and cutting them to hold a number would be the wrong trade.
 * The elision counts the rollup alone, so "… N more" is a count a reader can act on.
 */
export const MAX_ROUND_LINES = 10;

export function registerCommands(pi: ExtensionAPI, session: BoardSession, deps: { team?: TeamJoin } = {}): void {
	const team = deps.team ?? createTeamJoin(pi);
	pi.registerCommand(TEAM_COMMAND, {
		// The line and the guideline are the same sentence: `/team` is where a lead reads the round, and
		// `lib/board/round-text.ts` owns what it is called.
		description: `${LEAD_ROUND} \`/team join [<label>]\` joins the team`,
		getArgumentCompletions: (prefix: string) => {
			const text = prefix.trimStart();
			if (text.includes(" ")) return null;
			const items = TEAM_WORDS.filter((word) => word.startsWith(text));
			return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const [word = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (word === "join") {
				const label = rest.join(" ").trim();
				// A typed label is the one naming action: it is also Pi's session name, which is what
				// `/team join` is for. With no label the team names the session when it can — see
				// `unnamedJoin` — and the join renames nothing, because a name the file already lists is the
				// team's, not the user's.
				const asked: JoinAsk = label === "" ? await unnamedJoin(session, ctx) : { input: { label, name: true } };
				const joined = await team.join(ctx, asked.input);
				// The standing is the session's, not this command's: `/board status` reports the team
				// whichever door put it there, and a typed label is the one door that always asks.
				session.team.record(joined);
				// The bar draws a name only while the repository's team holds it, so the join that just
				// renamed this session is what puts that name on the list: otherwise the one door meant
				// to name the footer would leave the chip empty and say nothing about why.
				const named = joined.ok && label !== "" ? await nameTheBar(pi, ctx.cwd, joined.label) : undefined;
				ctx.ui.notify(
					joinedLine(joined, joinNote(named, asked.picked)),
					joined.ok && named?.ok !== false ? "info" : "warning",
				);
				return;
			}
			if (word !== "") {
				ctx.ui.notify(
					`team: "${word}" is not a word this command knows — try /team, or /team join [<label>]`,
					"warning",
				);
				return;
			}
			const store = await session.store(ctx.cwd);
			const cards = await store.list();
			// The roster is read as data, so a repository with no bus prints the round and
			// says nothing about who is here rather than failing.
			const roster = await session.roster(ctx.cwd);
			ctx.ui.notify(roundText(cards, session.now(), roster), "info");
		},
	});
}

/** What a bare `/team join` asks the bus for, and the project name it took when it took one. */
interface JoinAsk {
	input: TeamJoinInput;
	/** The `team.teammates` name this join picked; absent when it kept a name or drew one. */
	picked?: string;
}

/**
 * What a bare `/team join` asks for: nothing, when Pi already names the session and the bus can
 * derive that; else the name this session answers to — the record a claim wrote, the seat, or the
 * first free name the project's team lists, and the drawn one only when that list can give none.
 *
 * That choice is `who`'s, so this door reads it rather than drawing a second copy: the list is asked
 * once more only to say where the name came from. A name the project lists is the team's, not the
 * user's, so `name` is never set here: only a typed label is meant to rename the footer.
 */
async function unnamedJoin(session: BoardSession, ctx: ExtensionCommandContext): Promise<JoinAsk> {
	if ((sessionNameOf(ctx) ?? "").trim() !== "") return { input: {} };
	const who = await session.who(ctx, ctx.cwd);
	// The store's own team, because that is the list `who` drew from: a fresh read could name a team
	// the draw never saw. A store that will not open leaves the note off rather than failing a join.
	const team = await session.store(ctx.cwd).then(
		(store) => store.config().teammates,
		() => undefined,
	);
	const picked = isTeammate(who.label, team ?? []) ? who.label : undefined;
	return { input: { label: who.label }, ...(picked === undefined ? {} : { picked }) };
}

/**
 * Put the name this join made onto the team, then tell a bar to re-read it.
 *
 * The channel is the one load deferred to this door: the board's config is already paid by the store
 * this command reads, while the event name is not on the start path at all. It is emitted only for a
 * write that changed something — a bar re-reading an unchanged team is work for no name — and only
 * after the write, because the bar reads the file.
 */
async function nameTheBar(pi: ExtensionAPI, cwd: string, label: string): Promise<AddTeammateResult> {
	const { TEAM_CHANGED_CHANNEL } = await import("../../lib/events.ts");
	const named = addTeammate(cwd, label);
	if (named.ok && named.changed) pi.events.emit(TEAM_CHANGED_CHANNEL, { cwd });
	return named;
}

/**
 * `/team join`'s line: who this session is on the team, what the bar will draw, or why it is on
 * none.
 */
export function joinedLine(result: JoinResult, note?: string): string {
	if (!result.ok) return formatNotJoined(result.error);
	return formatJoined(result.label, result.watching, note);
}

/**
 * The round as the lines a lead reads: the rollup, then who is live.
 *
 * Capped, because a notify is a message and not a screen: past its limit the round says
 * how many lines it left out instead of pushing the rest of the session up the screen.
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
	if (lines.length > MAX_ROUND_LINES) shown.push(`… ${plural(lines.length - MAX_ROUND_LINES, "line")} more`);
	for (const line of stalledLines(named, roster, now)) shown.push(line);
	const who = presenceLine(roster, now, round);
	if (who !== undefined) shown.push(who);
	return shown.join("\n");
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

/**
 * `live: a — #2 execute · not listening: b · quiet: c — idle · gone: d — #4 plan`, or
 * nothing when nobody is here.
 *
 * Every state group names the session with what it is holding, from
 * `lib/board/round-text.ts`'s one phrase, so a line that says who is around also says what
 * they are doing: a session holding nothing reads `idle`, and one holding cards names the
 * first and counts the rest. `not listening:` is the exception, and it is a flag rather than
 * a state: it names a peer already listed under `live:`, so repeating its holding there
 * would print one session twice.
 *
 * Four facts, and the middle one is the one a lead can act on: a live session that is
 * not listening reads mail at its next turn rather than being woken for it. It is only
 * named when its record says so — a session that never wrote the field is not accused of
 * ignoring anything. `gone` is the loudest and comes last, because it is the one a lead
 * answers by reclaiming rather than by waiting. `not on the bus` is the fifth and a different
 * kind: an owner the board names, the bus has no record of, and that holds cards — the row the
 * page draws as `absent`. A session that never joined looks the same, so it states the fact
 * and offers no verb.
 */
function presenceLine(
	roster: readonly RosterSession[] | undefined,
	now: number,
	round: RoundSummary,
): string | undefined {
	if (roster === undefined || roster.length === 0) return undefined;
	// The owner groups are where the board already decided which label a card belongs to, so
	// the holding a session prints is the one its rollup line counted.
	const held = new Map(round.owners.map((group) => [labelKey(group.label), group.cards] as const));
	const session = (label: string): string => holdingLine(label, held.get(labelKey(label)) ?? []);
	const live: string[] = [];
	const quiet: string[] = [];
	const dead: string[] = [];
	const silent: string[] = [];
	const recorded = new Set(roster.map((record) => labelKey(record.label)));
	for (const record of roster) {
		const state = rosterStateOf(record, now);
		if (state === "gone") {
			dead.push(session(record.label));
			continue;
		}
		if (state !== "live") {
			quiet.push(session(record.label));
			continue;
		}
		live.push(session(record.label));
		if (record.watching?.armed === false) silent.push(record.label);
	}
	// The owners the bus holds no record of, as the board knows them: only the ones holding work are
	// worth a row, because an owner holding nothing is history and `formatRound` folds it.
	const unrecorded = round.owners
		.filter((group) => group.cards.length > 0 && !recorded.has(labelKey(group.label)))
		.map((group) => holdingLine(group.label, group.cards));
	const parts = [
		live.length > 0 ? `live: ${live.join(", ")}` : "",
		silent.length > 0 ? `not listening: ${silent.join(", ")}` : "",
		quiet.length > 0 ? `quiet: ${quiet.join(", ")}` : "",
		unrecorded.length > 0 ? `not on the bus: ${unrecorded.join(", ")}` : "",
		dead.length > 0 ? `gone: ${dead.join(", ")}` : "",
	];
	return parts.filter((part) => part !== "").join(" · ");
}

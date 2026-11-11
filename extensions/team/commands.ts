/**
 * `/team` — the lead's round, printed.
 *
 * The Team tab is the same round with a mouse; a lead reading a TUI should not have to
 * open a browser to see what needs a decision, so the command prints the rollup the
 * tool returns, the work a dead owner left behind, and one line saying who is live. It
 * reads the cards and the bus's records and writes nothing: acting on the round is
 * `team`'s tool (`assign`, `offer`, `reclaim`, `claim`) or `board`'s.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type Card, cardRef } from "../../lib/board/card.ts";
import { buildRound, type RoundSummary } from "../../lib/board/round.ts";
import { formatRound, holdingLine, plural } from "../../lib/board/round-text.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import { createTeamJoin, type JoinResult, type TeamJoin, type TeamJoinInput } from "../../lib/session-tool.ts";
import { type RosterSession, presenceOf, rosterStateOf } from "../../lib/session-roster.ts";
import { sessionNameOf } from "../../lib/session-label.ts";
import { formatJoined, formatNotJoined } from "./format.ts";

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
		description: "The lead's round: who holds what, and what needs a decision; `/team join [<label>]` joins the team",
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
				// `/team join` is for. With no label, a session Pi already names keeps that name and
				// the bus derives it; one with no name of its own draws a preset teammate name
				// instead of landing on the repository's basename, and the drawn name renames nothing
				// because it is the team's, not the user's.
				const input: TeamJoinInput = label === "" ? await unnamedJoin(session, ctx) : { label, name: true };
				const joined = await team.join(ctx, input);
				// The standing is the session's, not this command's: `/board status` reports the team
				// whichever door put it there, and a typed label is the one door that always asks.
				session.team.record(joined);
				ctx.ui.notify(joinedLine(joined), joined.ok ? "info" : "warning");
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

/**
 * What a bare `/team join` asks for: nothing, when Pi already names the session and the
 * bus can derive that, and otherwise the name the board draws for it.
 *
 * A drawn name is the team's, not the user's, so `name` is never set here: only a typed
 * label is meant to rename the footer.
 */
async function unnamedJoin(session: BoardSession, ctx: ExtensionCommandContext): Promise<TeamJoinInput> {
	if ((sessionNameOf(ctx) ?? "").trim() !== "") return {};
	return { label: (await session.who(ctx, ctx.cwd)).label };
}

/** `/team join`'s line: who this session is on the team, or why it is on none. */
export function joinedLine(result: JoinResult): string {
	return result.ok ? formatJoined(result.label, result.watching) : formatNotJoined(result.error);
}

/**
 * The round as the lines a lead reads: the rollup, then who is live.
 *
 * Capped, because a notify is a message and not a screen: past its limit the round says
 * how many lines it left out instead of pushing the rest of the session up the screen.
 */
export function roundText(cards: readonly Card[], now: number, roster?: readonly RosterSession[]): string {
	if (cards.length === 0) return "team: nothing to report — the board is empty";
	const round = buildRound(cards, now);
	// The cap covers the rollup: what a dead owner left, and who is here at all, follow it whole.
	const lines = formatRound(cards, round, roster).split("\n");
	const shown = lines.slice(0, MAX_ROUND_LINES);
	if (lines.length > MAX_ROUND_LINES) shown.push(`… ${plural(lines.length - MAX_ROUND_LINES, "line")} more`);
	for (const line of stalledLines(cards, roster, now)) shown.push(line);
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
 */
function stalledLines(cards: readonly Card[], roster: readonly RosterSession[] | undefined, now: number): string[] {
	if (roster === undefined) return [];
	const byOwner = new Map<string, { label: string; state: "quiet" | "gone"; refs: string[] }>();
	for (const card of cards) {
		if (card.owner === undefined || card.lane === "done") continue;
		const state = presenceOf(roster, card.owner, now);
		if (state !== "quiet" && state !== "gone") continue;
		const key = card.owner.label.toLowerCase();
		const entry = byOwner.get(key) ?? { label: card.owner.label, state, refs: [] };
		entry.refs.push(cardRef(card.id));
		byOwner.set(key, entry);
	}
	return [...byOwner.values()].map(({ label, state, refs }) => {
		const why = state === "gone" ? "is not running" : "has gone quiet";
		return `reclaim ${refs.join(", ")} — ${label} ${why}`;
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
	const held = new Map(round.owners.map((group) => [group.label.toLowerCase(), group.cards] as const));
	const session = (label: string): string => holdingLine(label, held.get(label.toLowerCase()) ?? []);
	const live: string[] = [];
	const quiet: string[] = [];
	const dead: string[] = [];
	const silent: string[] = [];
	const recorded = new Set(roster.map((record) => record.label.toLowerCase()));
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
		.filter((group) => group.cards.length > 0 && !recorded.has(group.label.toLowerCase()))
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

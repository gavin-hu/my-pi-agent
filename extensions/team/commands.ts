/**
 * `/team` — the lead's round, printed.
 *
 * The Team tab is the same round with a mouse; a lead reading a TUI should not have to
 * open a browser to see what needs a decision, so the command prints the rollup the
 * tool returns, the work a dead owner left behind, and one line saying who is live. It
 * reads the cards and the bus's records and writes nothing: acting on the round is
 * `team`'s tool (`assign`, `reclaim`) or `board`'s.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type Card, cardRef } from "../../lib/board/card.ts";
import { buildRound } from "../../lib/board/round.ts";
import { formatRound, plural } from "../../lib/board/round-text.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import { createTeamJoin, type JoinResult, type TeamJoin } from "../../lib/session-tool.ts";
import { readRoster, type RosterSession, rosterStateOf } from "../../lib/session-roster.ts";
import { formatJoined, formatNotJoined } from "./format.ts";

/** The command's name, which is also the word a user types. */
export const TEAM_COMMAND = "team";

/** The words the command accepts besides the round itself. */
export const TEAM_WORDS = ["join"] as const;

/** How many lines a round may print before it says how many it left out. */
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
				// The one naming action: a typed label is also Pi's session name, which is what
				// `/team join` is for. Joining without one leaves both to the bus.
				const joined = await team.join(ctx, label === "" ? {} : { label, name: true });
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
			const roster = await readRoster(await session.busDir(ctx.cwd));
			ctx.ui.notify(roundText(cards, session.now(), roster), "info");
		},
	});
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
	const round = formatRound(cards, buildRound(cards, now)).split("\n");
	const shown = round.slice(0, MAX_ROUND_LINES);
	if (round.length > MAX_ROUND_LINES) shown.push(`… ${plural(round.length - MAX_ROUND_LINES, "line")} more`);
	for (const line of goneLines(cards, roster, now)) shown.push(line);
	const who = presenceLine(roster, now);
	if (who !== undefined) shown.push(who);
	return shown.join("\n");
}

/**
 * The work a dead owner left behind, as the line that says who takes it.
 *
 * One line per gone owner that still holds cards, before the presence line: `gone: b` at
 * the end of that line says who died, and this one says what to do about it. A card that
 * waits on another is left to the board, whose rules would refuse the claim anyway.
 */
function goneLines(cards: readonly Card[], roster: readonly RosterSession[] | undefined, now: number): string[] {
	if (roster === undefined) return [];
	const gone = new Map<string, string>();
	for (const session of roster) {
		if (rosterStateOf(session, now) === "gone") gone.set(session.label.toLowerCase(), session.label);
	}
	if (gone.size === 0) return [];
	const byOwner = new Map<string, string[]>();
	for (const card of cards) {
		if (card.owner === undefined || card.status === "done") continue;
		const label = gone.get(card.owner.label.toLowerCase());
		if (label === undefined) continue;
		byOwner.set(label, [...(byOwner.get(label) ?? []), cardRef(card.id)]);
	}
	return [...byOwner.entries()].map(([label, refs]) => `reclaim ${refs.join(", ")} — ${label} is not running`);
}

/**
 * `live: a, b · not listening: b · quiet: c · gone: d`, or nothing when nobody is here.
 *
 * Four facts, and the middle one is the one a lead can act on: a live session that is
 * not listening reads mail at its next turn rather than being woken for it. It is only
 * named when its record says so — a session that never wrote the field is not accused of
 * ignoring anything. `gone` is the loudest and comes last, because it is the one a lead
 * answers by reclaiming rather than by waiting.
 */
function presenceLine(roster: readonly RosterSession[] | undefined, now: number): string | undefined {
	if (roster === undefined || roster.length === 0) return undefined;
	const live: string[] = [];
	const quiet: string[] = [];
	const dead: string[] = [];
	const silent: string[] = [];
	for (const session of roster) {
		const state = rosterStateOf(session, now);
		if (state === "gone") {
			dead.push(session.label);
			continue;
		}
		if (state !== "live") {
			quiet.push(session.label);
			continue;
		}
		live.push(session.label);
		if (session.watching?.armed === false) silent.push(session.label);
	}
	const parts = [
		live.length > 0 ? `live: ${live.join(", ")}` : "",
		silent.length > 0 ? `not listening: ${silent.join(", ")}` : "",
		quiet.length > 0 ? `quiet: ${quiet.join(", ")}` : "",
		dead.length > 0 ? `gone: ${dead.join(", ")}` : "",
	];
	return parts.filter((part) => part !== "").join(" · ");
}

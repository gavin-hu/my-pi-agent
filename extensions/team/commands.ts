/**
 * `/team` — the lead's round, printed.
 *
 * The Team tab is the same round with a mouse; a lead reading a TUI should not have to
 * open a browser to see what needs a decision, so the command prints the rollup the
 * tool returns and one line saying who is live. It reads the cards and the bus's records
 * and writes nothing: acting on the round is `team`'s tool (`assign`, `reclaim`) or
 * `board`'s.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Card } from "../../lib/board/card.ts";
import { buildRound } from "../../lib/board/round.ts";
import { formatRound, plural } from "../../lib/board/round-text.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import { readRoster, type RosterSession, rosterStateOf } from "../../lib/session-roster.ts";

/** The command's name, which is also the word a user types. */
export const TEAM_COMMAND = "team";

/** How many lines a round may print before it says how many it left out. */
export const MAX_ROUND_LINES = 10;

export function registerCommands(pi: ExtensionAPI, session: BoardSession): void {
	pi.registerCommand(TEAM_COMMAND, {
		description: "The lead's round: who holds what, and what needs a decision",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const store = await session.store(ctx.cwd);
			const cards = await store.list();
			// The roster is read as data, so a repository with no bus prints the round and
			// says nothing about who is here rather than failing.
			const roster = await readRoster(await session.busDir(ctx.cwd));
			ctx.ui.notify(roundText(cards, session.now(), roster), "info");
		},
	});
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
	const who = presenceLine(roster, now);
	if (who !== undefined) shown.push(who);
	return shown.join("\n");
}

/** `live: a, b · quiet: c`, or nothing when the bus has not recorded anyone here. */
function presenceLine(roster: readonly RosterSession[] | undefined, now: number): string | undefined {
	if (roster === undefined || roster.length === 0) return undefined;
	const live: string[] = [];
	const quiet: string[] = [];
	for (const session of roster) {
		(rosterStateOf(session, now) === "live" ? live : quiet).push(session.label);
	}
	const parts = [
		live.length > 0 ? `live: ${live.join(", ")}` : "",
		quiet.length > 0 ? `quiet: ${quiet.join(", ")}` : "",
	];
	return parts.filter((part) => part !== "").join(" · ");
}

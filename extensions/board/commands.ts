/**
 * `/board` — the page's one entry point.
 *
 * Three words, and everything else opens the page: `team` opens it on the Team tab,
 * `status` prints one line, `stop` closes it. The command is a thin parser over the
 * lifecycle in `page.ts`, so the idle grace and `session_shutdown` close the same
 * server this opens.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { plural } from "../../lib/board/round-text.ts";
import type { JoinResult } from "../../lib/session-tool.ts";
import { createTeamJoin, type TeamJoin } from "../../lib/session-tool.ts";
import { joinLabel, teamLine } from "./join.ts";
import type { BoardPage, BoardPageStatus } from "./page.ts";

/** The command's name, which is also the word a user types. */
export const BOARD_COMMAND = "board";

/** The words the command accepts, in the order a user is likely to want them. */
export const BOARD_WORDS = ["status", "stop", "team"] as const;

export function registerCommands(pi: ExtensionAPI, page: BoardPage, deps: { team?: TeamJoin } = {}): void {
	const team = deps.team ?? createTeamJoin(pi);
	/** What the last `/board` did about the team, for the status line. */
	let joined: JoinResult | undefined;
	pi.registerCommand(BOARD_COMMAND, {
		description: "Open the shared board in a local browser: /board [team | status | stop]",
		getArgumentCompletions: (prefix: string) => {
			const text = prefix.trimStart();
			if (text.includes(" ")) return null;
			const items = BOARD_WORDS.filter((word) => word.startsWith(text));
			return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const word = args.trim().toLowerCase();
			if (word === "status") {
				ctx.ui.notify(statusLine(page.status(), joined), "info");
				return;
			}
			if (word === "stop") {
				const status = page.status();
				// A page another session serves is that session's to stop, and saying whose it is is the answer.
				if (status.attached === true) {
					ctx.ui.notify(
						`board: nothing to stop here — ${status.seat} serves this repository on :${status.port}`,
						"info",
					);
					return;
				}
				ctx.ui.notify((await page.stop(ctx)) ? "board: stopped" : "board: not running", "info");
				return;
			}
			if (word !== "" && word !== "team") {
				ctx.ui.notify(
					`board: "${word}" is not a word this command knows — try /board, /board team, /board status, /board stop`,
					"warning",
				);
				return;
			}
			const started = await page.start(ctx, word === "team" ? "team" : "board");
			// A failed start has already said why. Otherwise the join happens here, because
			// opening the page is the lead's one action: the seat when this session serves it,
			// this session's own label when it watches a page somebody else serves.
			if (started.kind === "failed") return;
			joined = await team.join(ctx, joinLabel(started.kind === "served"));
			ctx.ui.notify(
				started.kind === "attached"
					? `board: ${started.seat} is serving this repository on :${started.port} — viewing${teamLine(joined)}`
					: `board: ${started.seat} serving ${started.where} on :${started.port}${teamLine(joined)}`,
				"info",
			);
		},
	});
}

/** One line for `/board status`: the page this session serves, watches, or does not have. */
export function statusLine(status: BoardPageStatus, team?: JoinResult): string {
	if (status.running) {
		const watching = plural(status.watchers ?? 0, "tab");
		return `board: ${status.seat} serving on :${status.port} · ${watching} watching · ${status.where}${teamLine(team)}`;
	}
	if (status.attached === true) {
		return `board: watching ${status.seat} on :${status.port} — nothing to stop here${teamLine(team)}`;
	}
	return "board: not running — /board opens it";
}

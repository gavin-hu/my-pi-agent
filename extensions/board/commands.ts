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
import type { BoardTeam } from "../../lib/board/session.ts";
import type { JoinResult } from "../../lib/session-tool.ts";
import { createTeamJoin, type TeamJoin } from "../../lib/session-tool.ts";
import { teamLine } from "./join.ts";
import type { BoardPage, BoardPageStatus } from "./page.ts";

/** The command's name, which is also the word a user types. */
export const BOARD_COMMAND = "board";

/** The words the command accepts, in the order a user is likely to want them. */
const BOARD_WORDS = ["status", "stop", "team"] as const;

export function registerCommands(
	pi: ExtensionAPI,
	session: BoardTeam,
	page: BoardPage,
	deps: { team?: TeamJoin } = {},
): void {
	const team = deps.team ?? createTeamJoin(pi);
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
				ctx.ui.notify(statusLine(await page.status(), session.team.last()), "info");
				return;
			}
			if (word === "stop") {
				const status = await page.status();
				// A note nobody answers is not a page to leave for the next session to trip over:
				// it is dropped here, and the line says whose it was.
				if (status.stale === true) {
					const dropped = await page.dropStale(ctx);
					ctx.ui.notify(
						dropped
							? `board: dropped ${status.seat}'s note for :${status.port} — it answered nobody`
							: `board: nothing to stop here — ${status.seat} is answering on :${status.port}`,
						"info",
					);
					return;
				}
				// A page another session serves is that session's to stop, and saying whose it is is the answer.
				if (status.attached === true) {
					ctx.ui.notify(
						`board: nothing to stop here — ${status.seat} serves this repository on :${status.port}`,
						"info",
					);
					return;
				}
				const stopped = await page.stop(ctx);
				// The word is this session saying it serves nothing now: the page clears the seat too
				// when it closes itself (the idle grace), and both writes are the same fact.
				session.serve(undefined);
				ctx.ui.notify(stopped ? "board: stopped" : "board: not running", "info");
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
			// A failed start has already said why. Otherwise the seat is set from the page's own
			// answer — the page a session serves is a role, and every name this session writes and
			// is addressed by follows from it — and the join happens here, because opening the page
			// is the lead's one action.
			if (started.kind === "failed") return;
			session.serve(started.kind === "served" ? started.seat : undefined);
			const joined = await team.join(ctx, { label: session.who(ctx, ctx.cwd).label });
			session.team.record(joined);
			// The address is on the line because the browser is not the only way in: a machine
			// with no default browser prints it here, and a tab closed by mistake is one
			// command from being opened again.
			ctx.ui.notify(
				started.kind === "attached"
					? `board: ${started.seat} is serving this repository on :${started.port} — viewing · open ${started.url}${teamLine(joined)}`
					: `board: ${started.seat} serving ${started.repo} on :${started.port} · open ${started.url}${teamLine(joined)}`,
				"info",
			);
		},
	});
}

/** One line for `/board status`: the page this session serves, watches, or does not have. */
export function statusLine(status: BoardPageStatus, team?: JoinResult): string {
	if (status.running) {
		const watching = plural(status.watchers ?? 0, "tab");
		return `board: ${status.seat} serving ${status.repo} on :${status.port} · ${watching} watching · ${status.where}${teamLine(team)}`;
	}
	if (status.stale === true) {
		return `board: watching ${status.seat} on :${status.port} — that note answers nobody; /board stop drops it${teamLine(team)}`;
	}
	if (status.attached === true) {
		return `board: watching ${status.seat} on :${status.port} — nothing to stop here${teamLine(team)}`;
	}
	// The team outlives the page: a session that claimed a card is on it with no page open, so
	// the line says which team this session is on whichever door put it there.
	return `board: not running — /board opens it${teamLine(team)}`;
}

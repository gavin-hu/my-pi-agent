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
import type { BoardPage, BoardPageStatus } from "./page.ts";

/** The command's name, which is also the word a user types. */
export const BOARD_COMMAND = "board";

/** The words the command accepts, in the order a user is likely to want them. */
export const BOARD_WORDS = ["status", "stop", "team"] as const;

export function registerCommands(pi: ExtensionAPI, page: BoardPage): void {
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
				ctx.ui.notify(statusLine(page.status()), "info");
				return;
			}
			if (word === "stop") {
				const status = page.status();
				// A viewer's page is somebody else's to stop, and saying whose is the answer.
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
			// A failed start has already said why; the other two say which page you are on, and
			// a viewer is told the one step that makes it reachable.
			if (started.kind === "failed") return;
			ctx.ui.notify(
				started.kind === "attached"
					? `board: ${started.seat} is serving this repository on :${started.port} — viewing (session watch for handoffs)`
					: `board: ${started.seat} serving ${started.where} on :${started.port}`,
				"info",
			);
		},
	});
}

/** One line for `/board status`: the page this session serves, watches, or does not have. */
export function statusLine(status: BoardPageStatus): string {
	if (status.running) {
		const watching = plural(status.watchers ?? 0, "tab");
		return `board: ${status.seat} serving on :${status.port} · ${watching} watching · ${status.where}`;
	}
	if (status.attached === true) {
		return `board: watching ${status.seat} on :${status.port} — nothing to stop here`;
	}
	return "board: not running — /board opens it";
}

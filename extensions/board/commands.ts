/**
 * `/board` — the page's one entry point.
 *
 * Three words, and everything else opens the page: `team` opens it on the Team tab,
 * `status` prints one line, `stop` closes it. The command is a thin parser over the
 * lifecycle in `page.ts`, so the idle grace and `session_shutdown` close the same
 * server this opens.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { BoardPage } from "./page.ts";

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
				const status = page.status();
				ctx.ui.notify(
					status.running
						? `board: ${status.seat} serving ${status.where} at ${status.url}`
						: "board: not running — /board opens it",
					"info",
				);
				return;
			}
			if (word === "stop") {
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
			// A failed start has already said why; a served one says where.
			if (started.kind === "failed") return;
			ctx.ui.notify(`board: ${started.seat} serving ${started.where} at ${started.url}`, "info");
		},
	});
}

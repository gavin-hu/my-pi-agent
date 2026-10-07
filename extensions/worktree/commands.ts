/**
 * Slash commands for the worktree extension.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { enterWorktree, exitWorktree, pruneWorktrees, worktreeLabel, worktreeStatus } from "./lifecycle.ts";

export function registerCommands(pi: ExtensionAPI): void {
	pi.registerCommand("worktree", {
		description: "Show the current worktree and list managed worktrees",
		handler: async (_args, ctx) => {
			ctx.ui.notify(await worktreeStatus(pi, ctx), "info");
		},
	});

	pi.registerCommand("worktree-enter", {
		description: "Enter a git worktree: /worktree-enter [name]",
		handler: async (args, ctx) => {
			const name = args.trim().split(/\s+/)[0] || undefined;
			try {
				const { state } = await enterWorktree(pi, ctx, { name });
				ctx.ui.notify(`Entered worktree ${worktreeLabel(state)}\n${state.path}`, "info");
			} catch (error) {
				ctx.ui.notify(`Enter failed: ${(error as Error).message}`, "error");
			}
		},
	});

	pi.registerCommand("worktree-exit", {
		description: "Exit the current worktree: /worktree-exit [--keep|--remove]",
		handler: async (args, ctx) => {
			const remove = args.includes("--remove") ? true : args.includes("--keep") ? false : undefined;
			try {
				const result = await exitWorktree(pi, ctx, { remove });
				ctx.ui.notify(result.output, "info");
			} catch (error) {
				ctx.ui.notify(`Exit failed: ${(error as Error).message}`, "error");
			}
		},
	});

	pi.registerCommand("worktree-prune", {
		description: "Remove clean, unused managed worktrees older than pruneAfterDays",
		handler: async (_args, ctx) => {
			ctx.ui.notify(await pruneWorktrees(pi, ctx), "info");
		},
	});
}

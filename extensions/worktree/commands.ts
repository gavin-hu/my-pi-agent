/**
 * Slash commands for the worktree extension.
 *
 * One `/worktree` command keeps the surface small and discoverable:
 *   /worktree                     status + list managed worktrees
 *   /worktree enter [name]        create or enter a worktree (name may be a PR/MR ref)
 *   /worktree exit [--keep|--remove]
 *   /worktree prune               remove clean, unused, old managed worktrees
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { enterWorktree, exitWorktree, pruneWorktrees, worktreeLabel, worktreeStatus } from "./lifecycle.ts";

interface Completion {
	value: string;
	label: string;
	description?: string;
}

const SUBCOMMANDS: Completion[] = [
	{ value: "status", label: "status", description: "Show the current worktree and list managed worktrees" },
	{ value: "enter", label: "enter", description: "Create or enter a worktree: enter [name]" },
	{ value: "exit", label: "exit", description: "Return to the main checkout: exit [--keep|--remove]" },
	{ value: "prune", label: "prune", description: "Remove clean, unused managed worktrees older than pruneAfterDays" },
];

const EXIT_FLAGS: Completion[] = [
	{ value: "--keep", label: "--keep", description: "Keep the worktree on exit" },
	{ value: "--remove", label: "--remove", description: "Remove the worktree on exit when safe" },
];

const USAGE = "Usage: /worktree [status|enter [name]|exit [--keep|--remove]|prune]";

export function registerCommands(pi: ExtensionAPI): void {
	pi.registerCommand("worktree", {
		description: "Manage git worktrees: /worktree [status|enter|exit|prune]",
		getArgumentCompletions: (prefix) => {
			const [action = "", argument, ...rest] = prefix.trimStart().split(/\s+/);
			if (rest.length > 0) return null;

			if (argument === undefined) {
				const items = SUBCOMMANDS.filter((item) => item.value.startsWith(action));
				return items.length > 0 ? items.map((item) => ({ ...item, value: `${item.value} ` })) : null;
			}

			if (action === "exit") {
				const flags = EXIT_FLAGS.filter((item) => item.value.startsWith(argument));
				return flags.length > 0 ? flags : null;
			}

			return null;
		},
		handler: async (args, ctx) => {
			const [sub = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);

			switch (sub) {
				case "status":
					ctx.ui.notify(await worktreeStatus(pi, ctx), "info");
					return;

				case "enter": {
					try {
						const { state } = await enterWorktree(pi, ctx, { name: rest[0] });
						ctx.ui.notify(`Entered worktree ${worktreeLabel(state)}\n${state.path}`, "info");
					} catch (error) {
						ctx.ui.notify(`Enter failed: ${(error as Error).message}`, "error");
					}
					return;
				}

				case "exit": {
					const remove = rest.includes("--remove") ? true : rest.includes("--keep") ? false : undefined;
					try {
						const result = await exitWorktree(pi, ctx, { remove });
						ctx.ui.notify(result.output, "info");
					} catch (error) {
						ctx.ui.notify(`Exit failed: ${(error as Error).message}`, "error");
					}
					return;
				}

				case "prune":
					ctx.ui.notify(await pruneWorktrees(pi, ctx), "info");
					return;

				default:
					ctx.ui.notify(`Unknown worktree subcommand "${sub}".\n${USAGE}`, "error");
			}
		},
	});
}

/**
 * Slash commands for the worktree extension.
 *
 * One `/worktree` command keeps the surface small: the bare command is the
 * worktree screen (the status text when the session is not a terminal), and three
 * verbs do the lifecycle.
 *
 *   /worktree                     the worktree screen
 *   /worktree enter [name]        create or re-enter a worktree (name may be a PR/MR ref)
 *   /worktree exit                leave; worktree.onExit and the prompt decide the fate
 *   /worktree prune               remove clean, unused, old managed worktrees
 *
 * There are no flags: the exit prompt already offers keep or remove and the
 * config sets the default, so a flag could only disagree with one of the two.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../../lib/errors.ts";
import { isPlanModeEnabled } from "../../lib/plan-state.ts";
import { withRailsSuppressed } from "../../lib/rails.ts";
import {
	enterWorktree,
	exitWorktree,
	formatWorktreeStatus,
	isWorktreeCancelled,
	pruneWorktrees,
	worktreeLabel,
	worktreeSnapshot,
} from "./lifecycle.ts";
import { type WorktreeAction, WorktreeListComponent } from "./screen.ts";

interface Completion {
	value: string;
	label: string;
	description?: string;
}

const SUBCOMMANDS: Completion[] = [
	{ value: "enter", label: "enter", description: "Create or enter a worktree: enter [name]" },
	{ value: "exit", label: "exit", description: "Return to the main checkout" },
	{ value: "prune", label: "prune", description: "Remove clean, unused managed worktrees older than pruneAfterDays" },
];

const USAGE = "Usage: /worktree [enter [name]|exit|prune]";

/** Refuse a lifecycle change while plan mode is read-only, as `/check` does. */
function refuseInPlanMode(ctx: ExtensionContext): boolean {
	if (!isPlanModeEnabled(ctx.sessionManager.getBranch())) return false;
	ctx.ui.notify("Plan mode is read-only. Approve the plan before changing worktrees.", "warning");
	return true;
}

async function runEnter(pi: ExtensionAPI, ctx: ExtensionContext, name: string | undefined): Promise<void> {
	if (refuseInPlanMode(ctx)) return;
	try {
		const { state } = await enterWorktree(pi, ctx, { name });
		ctx.ui.notify(`Entered worktree ${worktreeLabel(state)}\n${state.path}`, "info");
	} catch (error) {
		if (isWorktreeCancelled(error)) {
			ctx.ui.notify(messageOf(error), "info");
			return;
		}
		ctx.ui.notify(`Enter failed: ${messageOf(error)}`, "error");
	}
}

async function runExit(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (refuseInPlanMode(ctx)) return;
	try {
		const result = await exitWorktree(pi, ctx, {});
		ctx.ui.notify(result.output, "info");
	} catch (error) {
		if (isWorktreeCancelled(error)) {
			ctx.ui.notify(messageOf(error), "info");
			return;
		}
		ctx.ui.notify(`Exit failed: ${messageOf(error)}`, "error");
	}
}

async function runPrune(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (refuseInPlanMode(ctx)) return;
	ctx.ui.notify(await pruneWorktrees(pi, ctx), "info");
}

/** The bare command: the list screen in a terminal, the status text elsewhere. */
async function showWorktrees(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const snapshot = await worktreeSnapshot(pi, ctx);
	if (ctx.mode !== "tui") {
		ctx.ui.notify(formatWorktreeStatus(snapshot), "info");
		return;
	}
	// The screen closes before an enter or exit runs: both change the session
	// binding, and `exitWorktree` asks through `ctx.ui.select`, which cannot nest
	// inside a mounted screen. Prune runs in place, so its verb stays on the screen.
	const action = await withRailsSuppressed(pi, () =>
		ctx.ui.custom<WorktreeAction | undefined>((tui, theme, _keybindings, done) => {
			return new WorktreeListComponent({
				snapshot,
				theme,
				requestRender: () => tui.requestRender(),
				onDone: (next) => done(next),
				reload: () => worktreeSnapshot(pi, ctx),
				prune: () => pruneWorktrees(pi, ctx),
				readOnly: isPlanModeEnabled(ctx.sessionManager.getBranch()),
				viewportRowsSource: () => tui.terminal?.rows,
			});
		}),
	);
	if (!action) return;
	if (action.kind === "exit") await runExit(pi, ctx);
	else await runEnter(pi, ctx, action.name);
}

export function registerCommands(pi: ExtensionAPI): void {
	pi.registerCommand("worktree", {
		description: "Manage git worktrees: the worktree screen, or enter, exit, and prune",
		getArgumentCompletions: (prefix) => {
			const text = prefix.trimStart();
			if (text.includes(" ")) return null;
			const items = SUBCOMMANDS.filter((item) => item.value.startsWith(text));
			return items.length > 0 ? items.map((item) => ({ ...item, value: `${item.value} ` })) : null;
		},
		handler: async (args, ctx) => {
			const [sub = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);

			if (sub === "") {
				await showWorktrees(pi, ctx);
				return;
			}
			// Only `enter` takes an argument. Anything else is a typo, and a typo that
			// is silently ignored is how a command does something the user did not ask for.
			const allowed = sub === "enter" ? 1 : 0;
			if (rest.length > allowed) {
				ctx.ui.notify(`Unexpected argument "${rest[allowed]}".\n${USAGE}`, "error");
				return;
			}

			switch (sub) {
				case "enter":
					await runEnter(pi, ctx, rest[0]);
					return;
				case "exit":
					await runExit(pi, ctx);
					return;
				case "prune":
					await runPrune(pi, ctx);
					return;
				default:
					ctx.ui.notify(`Unknown worktree subcommand "${sub}".\n${USAGE}`, "error");
			}
		},
	});
}

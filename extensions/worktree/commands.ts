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
import {
	enteredWorktree,
	enterWorktree,
	exitWorktree,
	formatWorktreeStatus,
	isWorktreeCancelled,
	pruneWorktrees,
	worktreeSnapshot,
} from "./lifecycle.ts";
import type { WorktreeAction } from "./screen.ts";

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
async function refuseInPlanMode(ctx: ExtensionContext): Promise<boolean> {
	const { isPlanModeEnabled } = await import("../../lib/plan-state.ts");
	if (!isPlanModeEnabled(ctx.sessionManager.getBranch())) return false;
	const { planModeRefusal } = await import("../../lib/plan-entry.ts");
	ctx.ui.notify(planModeRefusal("changing worktrees"), "warning");
	return true;
}

/**
 * Run one lifecycle verb and report it the way a command does.
 *
 * Enter and exit differ in what they call and in the sentence a success prints, never in
 * how a refusal is reported: a cancellation is the choice the user just made and reads as
 * info, and everything else is a failure that names the verb that failed.
 */
async function reportLifecycle(ctx: ExtensionContext, verb: string, run: () => Promise<string>): Promise<void> {
	try {
		ctx.ui.notify(await run(), "info");
	} catch (error) {
		if (isWorktreeCancelled(error)) {
			ctx.ui.notify(messageOf(error), "info");
			return;
		}
		ctx.ui.notify(`${verb} failed: ${messageOf(error)}`, "error");
	}
}

async function runEnter(pi: ExtensionAPI, ctx: ExtensionContext, name: string | undefined): Promise<void> {
	if (await refuseInPlanMode(ctx)) return;
	// The path on its own line: a command's answer is read without a tool result beside it,
	// and "which directory am I in now" is the question entering answers.
	await reportLifecycle(ctx, "Enter", async () => {
		const { state } = await enterWorktree(pi, ctx, { name });
		return `${enteredWorktree(state)}\n${state.path}`;
	});
}

async function runExit(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (await refuseInPlanMode(ctx)) return;
	await reportLifecycle(ctx, "Exit", async () => (await exitWorktree(pi, ctx, {})).output);
}

async function runPrune(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (await refuseInPlanMode(ctx)) return;
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
	const { withRailsSuppressed } = await import("../../lib/rails.ts");
	const { WorktreeListComponent } = await import("./screen.ts");
	const { isPlanModeEnabled } = await import("../../lib/plan-state.ts");
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

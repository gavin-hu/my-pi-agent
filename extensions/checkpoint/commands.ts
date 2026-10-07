/**
 * Slash commands for the checkpoint extension.
 *
 * One `/checkpoint` command keeps the surface small:
 *   /checkpoint                 open the checkpoint menu (select, diff, restore, save, clear)
 *   /checkpoint save [label]    save a snapshot
 *   /checkpoint diff [id]       show what changed since a snapshot
 *   /checkpoint restore [id]    rewind (picks from a list when no id is given)
 *   /checkpoint clear           delete this worktree's checkpoint refs
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	formatChangeSummary,
	formatCheckpointChoice,
	formatCheckpointText,
	formatSavedText,
} from "./format.ts";
import type { CheckpointRuntime } from "./runtime.ts";
import { CheckpointListComponent, type CheckpointAction } from "./tui.ts";
import type { Checkpoint } from "./types.ts";

/** Lines of diff shown in a command notice before eliding. */
const DIFF_PREVIEW_LINES = 20;

function previewDiff(diff: string): string {
	const lines = diff.split("\n");
	if (lines.length <= DIFF_PREVIEW_LINES) return diff;
	return [...lines.slice(0, DIFF_PREVIEW_LINES), `… ${lines.length - DIFF_PREVIEW_LINES} more lines`].join("\n");
}

interface Completion {
	value: string;
	label: string;
	description?: string;
}

const SUBCOMMANDS: Completion[] = [
	{ value: "list", label: "list", description: "List checkpoints for this worktree" },
	{ value: "save", label: "save", description: "Save a checkpoint: save [label]" },
	{ value: "diff", label: "diff", description: "Diff the working tree against a checkpoint: diff [id]" },
	{ value: "restore", label: "restore", description: "Rewind to a checkpoint: restore [id]" },
	{ value: "clear", label: "clear", description: "Delete this worktree's checkpoint refs" },
];

const USAGE = "Usage: /checkpoint [list|save [label]|diff [id]|restore [id]|clear]";

/** Save a manual checkpoint and report it. */
async function saveCheckpoint(
	runtime: CheckpointRuntime,
	ctx: ExtensionCommandContext,
	label: string | undefined,
): Promise<void> {
	try {
		const checkpoint = await runtime.snapshot(ctx, { reason: "manual", label });
		await runtime.setStatus(ctx);
		ctx.ui.notify(formatSavedText(checkpoint), "info");
	} catch (error) {
		ctx.ui.notify(`Save failed: ${(error as Error).message}`, "warning");
	}
}

/** Confirm and delete this worktree's refs, including any orphaned refs. */
async function clearCheckpoints(runtime: CheckpointRuntime, ctx: ExtensionCommandContext, root: string): Promise<void> {
	const checkpoints = await runtime.list(root, false);
	const total = checkpoints.length;
	const approved = await ctx.ui.confirm(
		"Clear checkpoints?",
		`Delete ${total === 0 ? "all" : total} checkpoint reference(s) and any orphaned refs? The working tree is not touched.`,
	);
	if (!approved) {
		ctx.ui.notify("Clear cancelled.", "info");
		return;
	}
	const removed = await runtime.clear(root, false);
	await runtime.setStatus(ctx);
	ctx.ui.notify(
		removed === 0 ? "No checkpoints to clear." : `Cleared ${removed} checkpoint${removed === 1 ? "" : "s"}.`,
		"info",
	);
}

/** Show a checkpoint's change preview as a bounded notice. */
async function showDiff(
	runtime: CheckpointRuntime,
	ctx: ExtensionCommandContext,
	root: string,
	target: Checkpoint,
): Promise<void> {
	const result = await runtime.plan(root, target);
	if (!result.ok) {
		ctx.ui.notify(result.reason, "warning");
		return;
	}
	const body = result.plan.diff || "(no differences from the working tree)";
	ctx.ui.notify(
		`${formatCheckpointChoice(target)} (${formatChangeSummary(result.plan.changed, result.plan.removed)}):\n${previewDiff(body)}`,
		"info",
	);
}

/** Confirm and apply a rewind, including a diff preview in the prompt. */
async function restoreCheckpoint(
	runtime: CheckpointRuntime,
	ctx: ExtensionCommandContext,
	root: string,
	target: Checkpoint,
): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Restoring the working tree needs an interactive UI.", "warning");
		return;
	}
	const result = await runtime.plan(root, target);
	if (!result.ok) {
		ctx.ui.notify(result.reason, "warning");
		return;
	}
	const detail = previewDiff(result.plan.diff || "(no differences)");
	const approved = await ctx.ui.confirm(
		"Restore this checkpoint?",
		`${formatCheckpointChoice(target)}\n${formatChangeSummary(result.plan.changed, result.plan.removed)} since the snapshot. ` +
			`This rewrites the working tree (HEAD is untouched).\n\n${detail}`,
	);
	if (!approved) {
		ctx.ui.notify("Restore cancelled.", "info");
		return;
	}
	try {
		const restored = await runtime.restore(root, target, runtime.configFor(root));
		await runtime.setStatus(ctx);
		ctx.ui.notify(
			`Restored #${target.id}: ${restored.changed} changed, ${restored.removed} removed.` +
				(restored.safety ? ` Safety checkpoint #${restored.safety}.` : ""),
			"info",
		);
	} catch (error) {
		ctx.ui.notify(`Restore failed: ${(error as Error).message}`, "error");
	}
}

/** Choose a checkpoint. The TUI opens the selectable list; other modes fall back
 * to `select` (supported by RPC) or the newest checkpoint. */
async function chooseCheckpoint(
	ctx: ExtensionCommandContext,
	checkpoints: Checkpoint[],
	loadStats: (checkpoint: Checkpoint) => Promise<{ changed: number; removed: number }>,
): Promise<CheckpointAction | undefined> {
	if (ctx.mode === "tui") {
		return ctx.ui.custom<CheckpointAction | undefined>((tui, theme, _keybindings, done) =>
			new CheckpointListComponent({
				checkpoints,
				theme,
				onClose: (action) => done(action),
				requestRender: () => tui.requestRender(),
				viewportRows: tui.terminal?.rows,
				loadStats,
			}),
		);
	}
	if (checkpoints.length === 0) return undefined;
	if (!ctx.hasUI || checkpoints.length === 1) return { action: "restore", checkpoint: checkpoints[0] };
	const labels = checkpoints.map((checkpoint) => formatCheckpointChoice(checkpoint));
	const chosen = await ctx.ui.select("Restore which checkpoint?", labels);
	if (!chosen) return undefined;
	return { action: "restore", checkpoint: checkpoints[labels.indexOf(chosen)] };
}

/**
 * The interactive menu loop. Diff, save, and clear keep the menu open; a restore
 * closes it. This is the primary surface, so it owns every action.
 */
async function openMenu(runtime: CheckpointRuntime, ctx: ExtensionCommandContext, root: string): Promise<void> {
	const loadStats = async (checkpoint: Checkpoint) => {
		const result = await runtime.plan(root, checkpoint);
		if (!result.ok) throw new Error(result.reason);
		return { changed: result.plan.changed, removed: result.plan.removed };
	};

	for (;;) {
		const checkpoints = await runtime.list(root, false);
		const choice = await chooseCheckpoint(ctx, checkpoints, loadStats);
		if (!choice) return;

		if (choice.action === "save") {
			const label = await ctx.ui.input("Checkpoint label (optional)");
			if (label === undefined) continue;
			await saveCheckpoint(runtime, ctx, label.trim() || undefined);
			continue;
		}
		if (choice.action === "clear") {
			await clearCheckpoints(runtime, ctx, root);
			continue;
		}
		if (choice.action === "diff") {
			await showDiff(runtime, ctx, root, choice.checkpoint);
			continue;
		}
		await restoreCheckpoint(runtime, ctx, root, choice.checkpoint);
		return;
	}
}

export function registerCommands(pi: ExtensionAPI, runtime: CheckpointRuntime): void {
	pi.registerCommand("checkpoint", {
		description: "Snapshot and rewind the working tree: /checkpoint [list|save|diff|restore|clear]",
		getArgumentCompletions: (prefix) => {
			const [action = "", argument] = prefix.trimStart().split(/\s+/);
			if (argument !== undefined) return null;
			const items = SUBCOMMANDS.filter((item) => item.value.startsWith(action));
			return items.length > 0 ? items.map((item) => ({ ...item, value: `${item.value} ` })) : null;
		},
		handler: async (args, ctx) => {
			const [sub = "list", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const root = await runtime.rootFor(ctx);
			if (!root) {
				ctx.ui.notify("Not inside a git repository.", "warning");
				return;
			}

			switch (sub) {
				case "list": {
					if (ctx.mode === "tui") {
						await openMenu(runtime, ctx, root);
						return;
					}
					ctx.ui.notify(formatCheckpointText(await runtime.list(root, false)), "info");
					return;
				}

				case "save": {
					await saveCheckpoint(runtime, ctx, rest.join(" ").trim() || undefined);
					return;
				}

				case "diff": {
					const target = await runtime.get(root, rest[0] ?? "last", false);
					if (!target) {
						ctx.ui.notify(`No checkpoint "${rest[0] ?? "last"}" found.`, "warning");
						return;
					}
					await showDiff(runtime, ctx, root, target);
					return;
				}

				case "restore": {
					if (rest[0]) {
						const target = await runtime.get(root, rest[0], false);
						if (!target) {
							ctx.ui.notify(`No checkpoint "${rest[0]}" found.`, "warning");
							return;
						}
						await restoreCheckpoint(runtime, ctx, root, target);
						return;
					}
					if (ctx.mode === "tui") {
						await openMenu(runtime, ctx, root);
						return;
					}
					const loadStats = async (checkpoint: Checkpoint) => {
						const result = await runtime.plan(root, checkpoint);
						if (!result.ok) throw new Error(result.reason);
						return { changed: result.plan.changed, removed: result.plan.removed };
					};
					const choice = await chooseCheckpoint(ctx, await runtime.list(root, false), loadStats);
					if (!choice || choice.action === "save" || choice.action === "clear") {
						ctx.ui.notify("No checkpoint to restore.", "warning");
						return;
					}
					if (choice.action === "diff") await showDiff(runtime, ctx, root, choice.checkpoint);
					else await restoreCheckpoint(runtime, ctx, root, choice.checkpoint);
					return;
				}

				case "clear": {
					await clearCheckpoints(runtime, ctx, root);
					return;
				}

				default:
					ctx.ui.notify(`Unknown checkpoint subcommand "${sub}".\n${USAGE}`, "warning");
			}
		},
	});
}

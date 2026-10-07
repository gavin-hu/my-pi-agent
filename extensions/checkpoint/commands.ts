/**
 * Slash commands for the checkpoint extension.
 *
 * One `/checkpoint` command keeps the surface small:
 *   /checkpoint                 list checkpoints
 *   /checkpoint save [label]    save a snapshot
 *   /checkpoint diff [id]       show what changed since a snapshot
 *   /checkpoint restore [id]    rewind (picks from a list when no id is given)
 *   /checkpoint clear           delete all checkpoint refs for this worktree
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatChangeSummary, formatCheckpointText, formatRelativeTime, formatSavedText, reasonLabel } from "./format.ts";
import type { CheckpointRuntime } from "./runtime.ts";
import type { Checkpoint } from "./types.ts";

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

/** Pick a checkpoint by id, or interactively when a UI is available. */
async function pickTarget(
	runtime: CheckpointRuntime,
	ctx: ExtensionCommandContext,
	root: string,
	id: string | undefined,
): Promise<Checkpoint | undefined> {
	if (id) return runtime.get(root, id, false);
	const checkpoints = await runtime.list(root, false);
	if (checkpoints.length === 0) return undefined;
	if (!ctx.hasUI || checkpoints.length === 1) return checkpoints[0];
	const labels = checkpoints.map((checkpoint) => `#${checkpoint.id}  ${reasonLabel(checkpoint)}  ${formatRelativeTime(checkpoint.timestamp)}`);
	const chosen = await ctx.ui.select("Restore which checkpoint?", labels);
	if (!chosen) return undefined;
	const index = labels.indexOf(chosen);
	return checkpoints[index];
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
					ctx.ui.notify(formatCheckpointText(await runtime.list(root, false)), "info");
					return;
				}

				case "save": {
					try {
						const label = rest.join(" ").trim() || undefined;
						const checkpoint = await runtime.snapshot(ctx, { reason: "manual", label });
						await runtime.setStatus(ctx);
						ctx.ui.notify(formatSavedText(checkpoint), "info");
					} catch (error) {
						ctx.ui.notify(`Save failed: ${(error as Error).message}`, "warning");
					}
					return;
				}

				case "diff": {
					const target = await runtime.get(root, rest[0] ?? "last", false);
					if (!target) {
						ctx.ui.notify(`No checkpoint "${rest[0] ?? "last"}" found.`, "warning");
						return;
					}
					const result = await runtime.plan(root, target);
					if (!result.ok) {
						ctx.ui.notify(result.reason, "warning");
						return;
					}
					const body = result.plan.diff || "(no differences from the working tree)";
					ctx.ui.notify(`#${target.id} (${result.plan.changed} changed, ${result.plan.removed} added):\n${body}`, "info");
					return;
				}

				case "restore": {
					const target = await pickTarget(runtime, ctx, root, rest[0]);
					if (!target) {
						ctx.ui.notify("No checkpoint to restore.", "warning");
						return;
					}
					const result = await runtime.plan(root, target);
					if (!result.ok) {
						ctx.ui.notify(result.reason, "warning");
						return;
					}
					const approved = await ctx.ui.confirm(
						`Restore checkpoint #${target.id}?`,
						`${formatChangeSummary(result.plan.changed, result.plan.removed)} since the snapshot. ` +
							`This rewrites the working tree (HEAD is untouched).`,
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
					return;
				}

				case "clear": {
					const checkpoints = await runtime.list(root, false);
					if (checkpoints.length === 0) {
						ctx.ui.notify("No checkpoints to clear.", "info");
						return;
					}
					const approved = await ctx.ui.confirm(
						"Clear checkpoints?",
						`Delete ${checkpoints.length} checkpoint reference(s)? The working tree is not touched.`,
					);
					if (!approved) {
						ctx.ui.notify("Clear cancelled.", "info");
						return;
					}
					const removed = await runtime.clear(root, false);
					await runtime.setStatus(ctx);
					ctx.ui.notify(`Cleared ${removed} checkpoint${removed === 1 ? "" : "s"}.`, "info");
					return;
				}

				default:
					ctx.ui.notify(`Unknown checkpoint subcommand "${sub}".\n${USAGE}`, "warning");
			}
		},
	});
}

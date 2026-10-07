/**
 * Model-facing registration for the `checkpoint` tool.
 *
 * One tool with five actions: `save`, `list`, `diff`, `restore`, `clear`.
 * `restore` requires confirmation through the interactive UI and never runs
 * headless, because it overwrites the working tree. All failures come back as
 * an error result carrying a model-readable message.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	formatCallText,
	formatChangeSummary,
	formatCheckpointText,
	formatRestoreText,
	formatSavedText,
} from "./format.ts";
import type { CheckpointRuntime } from "./runtime.ts";
import { CheckpointParams, normalizeCall, type CheckpointArgs } from "./schema.ts";
import type { CheckpointDetails } from "./types.ts";

export const TOOL_NAME = "checkpoint";

/** Lines of diff shown in the confirmation and result. */
const DIFF_PREVIEW_LINES = 20;

function errorResult(action: CheckpointDetails["action"], message: string): CheckpointToolResult {
	return {
		content: [{ type: "text", text: `Error: ${message}` }],
		details: { action, error: message },
		isError: true,
	};
}

type CheckpointToolResult = {
	content: Array<{ type: "text"; text: string }>;
	details: CheckpointDetails;
	isError?: boolean;
};

function previewDiff(diff: string, expanded: boolean): string {
	const lines = diff.split("\n");
	if (expanded || lines.length <= DIFF_PREVIEW_LINES) return diff;
	return [...lines.slice(0, DIFF_PREVIEW_LINES), `… ${lines.length - DIFF_PREVIEW_LINES} more lines`].join("\n");
}

export function registerTools(pi: ExtensionAPI, runtime: CheckpointRuntime): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Checkpoint",
		description:
			"Snapshot the working tree before risky changes, and rewind to an earlier snapshot. Snapshots are git commits " +
			"kept under refs/pi/checkpoints; they never move HEAD or touch your real index. Actions: `save` (with an optional " +
			"label), `list`, `diff` (id defaults to the newest), `restore` (rewind; needs user confirmation), and `clear`.",
		promptSnippet: "Snapshot and rewind the working tree (save, list, diff, restore, clear).",
		promptGuidelines: [
			"Use checkpoint `save` before a risky refactor, and `restore` to undo to an earlier snapshot.",
			"A `restore` rewrites the working tree, so it asks the user to confirm first.",
		],
		parameters: CheckpointParams,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			let call;
			try {
				call = normalizeCall(params as CheckpointArgs);
			} catch (error) {
				return errorResult((params as CheckpointArgs)?.action ?? "list", (error as Error).message);
			}

			const root = await runtime.rootFor(ctx);
			if (!root) return errorResult(call.action, "not inside a git repository.");

			try {
				switch (call.action) {
					case "save": {
						const checkpoint = await runtime.snapshot(ctx, { reason: "manual", label: call.label });
						await runtime.setStatus(ctx);
						return {
							content: [{ type: "text", text: formatSavedText(checkpoint) }],
							details: { action: "save", checkpoint } satisfies CheckpointDetails,
						};
					}

					case "list": {
						const checkpoints = await runtime.list(root, call.all);
						return {
							content: [{ type: "text", text: formatCheckpointText(checkpoints) }],
							details: { action: "list", checkpoints } satisfies CheckpointDetails,
						};
					}

					case "diff": {
						const target = await runtime.get(root, call.id ?? "last", call.all);
						if (!target) return errorResult("diff", `no checkpoint "${call.id ?? "last"}" found.`);
						const result = await runtime.plan(root, target);
						if (!result.ok) return errorResult("diff", result.reason);
						const body = result.plan.diff || "(no differences from the working tree)";
						return {
							content: [
								{
									type: "text",
									text: `Checkpoint #${target.id} vs working tree (${formatChangeSummary(result.plan.changed, result.plan.removed)}):\n${body}`,
								},
							],
							details: { action: "diff", checkpoint: target, diff: result.plan.diff } satisfies CheckpointDetails,
						};
					}

					case "restore": {
						const target = await runtime.get(root, call.id ?? "last", call.all);
						if (!target) return errorResult("restore", `no checkpoint "${call.id ?? "last"}" found.`);
						if (target.root !== root) {
							return errorResult("restore", `checkpoint #${target.id} belongs to a different worktree (${target.root}).`);
						}
						const result = await runtime.plan(root, target);
						if (!result.ok) return errorResult("restore", result.reason);
						if (!ctx.hasUI) {
							return errorResult(
								"restore",
								"no interactive UI is available to confirm restoring the working tree. Ask the user to run /checkpoint restore.",
							);
						}
						const detail = previewDiff(result.plan.diff || "(no differences)", false);
						const approved = await ctx.ui.confirm(
							`Restore checkpoint #${target.id}?`,
							`${formatChangeSummary(result.plan.changed, result.plan.removed)} since the snapshot. ` +
								`This rewrites the working tree (HEAD is untouched).\n\n${detail}`,
						);
						if (!approved) {
							return {
								content: [{ type: "text", text: "Restore cancelled; the working tree is unchanged." }],
								details: { action: "restore", checkpoint: target } satisfies CheckpointDetails,
							};
						}
						const config = runtime.configFor(root);
						const restored = await runtime.restore(root, target, config);
						await runtime.setStatus(ctx);
						return {
							content: [{ type: "text", text: formatRestoreText(restored) }],
							details: { action: "restore", checkpoint: target, restored } satisfies CheckpointDetails,
						};
					}

					case "clear": {
						const checkpoints = await runtime.list(root, call.all);
						if (checkpoints.length === 0) {
							return {
								content: [{ type: "text", text: "No checkpoints to clear." }],
								details: { action: "clear", checkpoints: [], cleared: 0 } satisfies CheckpointDetails,
							};
						}
						if (ctx.hasUI) {
							const approved = await ctx.ui.confirm(
								"Clear checkpoints?",
								`Delete ${checkpoints.length} checkpoint reference(s)? The working tree is not touched, but they can no longer be restored.`,
							);
							if (!approved) {
								return {
									content: [{ type: "text", text: "Clear cancelled." }],
									details: { action: "clear", checkpoints } satisfies CheckpointDetails,
								};
							}
						}
						const removed = await runtime.clear(root, call.all);
						await runtime.setStatus(ctx);
						return {
							content: [{ type: "text", text: `Cleared ${removed} checkpoint${removed === 1 ? "" : "s"}.` }],
							details: { action: "clear", checkpoints: [], cleared: removed } satisfies CheckpointDetails,
						};
					}
				}
			} catch (error) {
				return errorResult(call.action, (error as Error).message);
			}
		},

		renderCall(args, theme, context) {
			return new Text(
				theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) +
					theme.fg("muted", formatCallText(args as CheckpointArgs, context.argsComplete)),
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as CheckpointDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			switch (details.action) {
				case "save":
					return new Text(
						theme.fg("success", "✓ ") +
							theme.fg("muted", details.checkpoint ? formatSavedText(details.checkpoint) : "Checkpoint saved"),
						0,
						0,
					);
				case "list":
					return new Text(theme.fg("muted", formatCheckpointText(details.checkpoints ?? [])), 0, 0);
				case "diff":
					return new Text(theme.fg("dim", previewDiff(details.diff ?? "(no differences)", expanded)), 0, 0);
				case "restore":
					return new Text(
						details.restored
							? theme.fg("success", "✓ ") + theme.fg("muted", formatRestoreText(details.restored))
							: theme.fg("muted", "Restore cancelled"),
						0,
						0,
					);
				case "clear": {
					if (details.cleared === undefined) return new Text(theme.fg("muted", "Clear cancelled"), 0, 0);
					if (details.cleared === 0) return new Text(theme.fg("muted", "No checkpoints to clear"), 0, 0);
					const count = details.cleared;
					return new Text(
						theme.fg("success", "✓ ") +
							theme.fg("muted", `Cleared ${count} checkpoint${count === 1 ? "" : "s"}`),
						0,
						0,
					);
				}
			}
		},
	});
}

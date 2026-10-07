/**
 * Model-facing registration for the `checkpoint` tool.
 *
 * The only model action is `save`: mark a labeled point in the working tree.
 * The working tree is checkpointed automatically at the start of each prompt,
 * and the user reviews and restores checkpoints with the `/checkpoint` menu.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatSavedText } from "./format.ts";
import type { CheckpointRuntime } from "./runtime.ts";
import { CheckpointParams, normalizeSave, type CheckpointArgs } from "./schema.ts";
import type { CheckpointDetails } from "./types.ts";

export const TOOL_NAME = "checkpoint";

type CheckpointToolResult = {
	content: Array<{ type: "text"; text: string }>;
	details: CheckpointDetails;
	isError?: boolean;
};

function errorResult(message: string): CheckpointToolResult {
	return {
		content: [{ type: "text", text: `Error: ${message}` }],
		details: { error: message },
		isError: true,
	};
}

export function registerTools(pi: ExtensionAPI, runtime: CheckpointRuntime): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Checkpoint",
		description:
			"Save a labeled checkpoint of the working tree before a risky change. The working tree is already " +
			"checkpointed automatically at the start of each prompt; use this to mark a point mid-task. Checkpoints " +
			"never move HEAD or touch the real index, and the user restores them from the /checkpoint menu.",
		promptSnippet: "Save a labeled working-tree checkpoint before a risky change.",
		promptGuidelines: [
			"Use checkpoint `save` before a risky refactor to mark a point the user can return to.",
			"Checkpoints are restored from the /checkpoint menu, so the user is always in control of a rewind.",
		],
		parameters: CheckpointParams,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			let call;
			try {
				call = normalizeSave(params);
			} catch (error) {
				return errorResult((error as Error).message);
			}

			const root = await runtime.rootFor(ctx);
			if (!root) return errorResult("not inside a git repository.");

			try {
				const checkpoint = await runtime.snapshot(ctx, { reason: "manual", label: call.label });
				await runtime.setStatus(ctx);
				return {
					content: [{ type: "text", text: formatSavedText(checkpoint) }],
					details: { checkpoint } satisfies CheckpointDetails,
				};
			} catch (error) {
				return errorResult((error as Error).message);
			}
		},

		renderCall(args, theme) {
			const label = (args as CheckpointArgs | undefined)?.label;
			const detail = typeof label === "string" && label.trim() ? `"${label.trim()}"` : "save";
			return new Text(theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + theme.fg("muted", detail), 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as CheckpointDetails | undefined;
			if (details?.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			return new Text(
				theme.fg("success", "✓ ") +
					theme.fg("muted", details?.checkpoint ? formatSavedText(details.checkpoint) : "Checkpoint saved"),
				0,
				0,
			);
		},
	});
}

/**
 * Pure text formatting for the checkpoint extension.
 *
 * No terminal access and no theme: these turn checkpoints and restore summaries
 * into the short strings the tool result, command notice, and renderer show.
 */

import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { sanitize } from "../_shared/format.ts";
import type { Checkpoint, RestoreSummary } from "./types.ts";

/** Longest label shown before truncation. */
export const LABEL_WIDTH = 48;

/** Truncate text to `max` display columns, appending `…` when cut. */
function truncate(text: string, max = LABEL_WIDTH): string {
	return visibleWidth(text) > max ? `${sliceByColumn(text, 0, max - 1)}…` : text;
}

/** `3s ago`, `2m ago`, `1h ago`, `4d ago`. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

/** A one-line description of why a checkpoint exists. */
export function reasonLabel(checkpoint: Checkpoint): string {
	if (checkpoint.label) return checkpoint.label;
	if (checkpoint.reason === "auto") return checkpoint.tool ? `before ${checkpoint.tool}` : "automatic";
	if (checkpoint.reason === "pre-restore") return "before restore";
	return "manual";
}

/** `#<id>  <reason>  <relative time>` for a single checkpoint. */
export function formatCheckpointLine(checkpoint: Checkpoint, now = Date.now()): string {
	const reason = truncate(sanitize(reasonLabel(checkpoint)));
	return `#${checkpoint.id}  ${reason}  ${formatRelativeTime(checkpoint.timestamp, now)}`;
}

/** Model-facing list text. */
export function formatCheckpointText(checkpoints: Checkpoint[], now = Date.now()): string {
	if (checkpoints.length === 0) {
		return "No checkpoints yet. Use the checkpoint tool with action \"save\" to create one.";
	}
	const lines = checkpoints.map((checkpoint) => formatCheckpointLine(checkpoint, now));
	return [`${checkpoints.length} checkpoint${checkpoints.length === 1 ? "" : "s"} (newest first):`, ...lines].join("\n");
}

/** Model-facing save confirmation. */
export function formatSavedText(checkpoint: Checkpoint): string {
	return `Saved checkpoint #${checkpoint.id} (${reasonLabel(checkpoint)}). Use the checkpoint tool to restore it.`;
}

/** `2 files changed, 1 created` for a diff or restore preview. */
export function formatChangeSummary(changed: number, removed: number): string {
	const changedText = `${changed} file${changed === 1 ? "" : "s"} changed`;
	return removed > 0 ? `${changedText}, ${removed} created` : changedText;
}

/** Model-facing restore confirmation. */
export function formatRestoreText(summary: RestoreSummary): string {
	const parts = [`Restored checkpoint #${summary.id}: ${summary.changed} file${summary.changed === 1 ? "" : "s"} changed`];
	if (summary.removed > 0) parts.push(`${summary.removed} removed`);
	const line = `${parts.join(", ")}.`;
	const safety = summary.safety ? ` A safety checkpoint #${summary.safety} captures the pre-restore state.` : "";
	return `${line}${safety}`;
}

/** Call-line action text shown after the tool name (e.g. `checkpoint save`). */
export interface CallArgs {
	action?: string;
	id?: string;
	label?: string;
	all?: boolean;
}

/**
 * Action text for the transcript call line. Adds the label for `save` and the
 * target id for `diff`/`restore`, so two calls of the same action are not
 * indistinguishable.
 */
export function formatCallText(args: CallArgs | undefined, argsComplete = true): string {
	const action = args?.action;
	if (!action) return argsComplete ? "" : "…";
	if (action === "save" && typeof args?.label === "string" && args.label.trim()) {
		return `save  "${truncate(sanitize(args.label))}"`;
	}
	if ((action === "restore" || action === "diff") && typeof args?.id === "string" && args.id) {
		return `${action}  #${args.id}`;
	}
	if (action === "list" && args?.all) return "list  --all";
	return action;
}

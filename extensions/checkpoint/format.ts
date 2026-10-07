/**
 * Pure text formatting for the checkpoint extension.
 *
 * No terminal access and no theme: these turn checkpoints and restore summaries
 * into the short strings the tool result, command notice, and renderer show.
 */

import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitize } from "../_shared/format.ts";
import type { Checkpoint, RestoreSummary } from "./types.ts";

/** Longest label shown before truncation. */
export const LABEL_WIDTH = 48;

/** Longest stored prompt summary, so metadata commits stay small. */
export const PROMPT_WIDTH = 100;

/** Truncate text to `max` display columns, appending `…` when cut. */
function truncate(text: string, max = LABEL_WIDTH): string {
	return visibleWidth(text) > max ? `${sliceByColumn(text, 0, max - 1)}…` : text;
}

/**
 * A short, single-line summary of a user prompt for storage and display.
 * Takes the first non-empty line, collapses whitespace, and truncates.
 */
export function summarizePrompt(text: string): string | undefined {
	const line = text
		.split(/\r?\n/)
		.map((part) => sanitize(part))
		.find((part) => part.length > 0);
	if (!line) return undefined;
	return visibleWidth(line) > PROMPT_WIDTH ? `${sliceByColumn(line, 0, PROMPT_WIDTH - 1)}…` : line;
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
	if (checkpoint.prompt) return `"${checkpoint.prompt}"`;
	if (checkpoint.reason === "pre-restore") return "before restore";
	if (checkpoint.reason === "auto") return "automatic";
	return "manual";
}

/** Leading glyph distinguishing manual, pre-restore, and automatic checkpoints. */
export function reasonGlyph(checkpoint: Checkpoint): string {
	if (checkpoint.label || checkpoint.reason === "manual") return "✎";
	if (checkpoint.reason === "pre-restore") return "↩";
	return "⟲";
}

/** `#<id>  <reason>  <relative time>` for a single checkpoint. */
export function formatCheckpointLine(checkpoint: Checkpoint, now = Date.now()): string {
	const reason = truncate(sanitize(reasonLabel(checkpoint)));
	return `#${checkpoint.id}  ${reason}  ${formatRelativeTime(checkpoint.timestamp, now)}`;
}

/**
 * Id-free row for the interactive list: `⟲ "prompt"          2m ago`.
 * The reason label is truncated to fit and the time is right-aligned, so the
 * whole row never exceeds `width`.
 */
export function formatCheckpointRow(checkpoint: Checkpoint, now = Date.now(), width = 80): string {
	const prefix = `${reasonGlyph(checkpoint)} `;
	const suffix = `  ${formatRelativeTime(checkpoint.timestamp, now)}`;
	const available = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix));
	const label = truncate(sanitize(reasonLabel(checkpoint)), available);
	const gap = Math.max(1, width - visibleWidth(prefix) - visibleWidth(label) - visibleWidth(suffix));
	return truncateToWidth(`${prefix}${label}${" ".repeat(gap)}${suffix}`, width);
}

/**
 * Id-free label for a picker row: `"prompt"  ·  2m ago`.
 */
export function formatCheckpointChoice(checkpoint: Checkpoint, now = Date.now()): string {
	const label = truncate(sanitize(reasonLabel(checkpoint)), LABEL_WIDTH);
	return `${label}  ·  ${formatRelativeTime(checkpoint.timestamp, now)}`;
}

/** Model-facing list text. */
export function formatCheckpointText(checkpoints: Checkpoint[], now = Date.now()): string {
	if (checkpoints.length === 0) {
		return "No checkpoints yet. Use /checkpoint save to create one.";
	}
	const lines = checkpoints.map((checkpoint) => formatCheckpointLine(checkpoint, now));
	return [`${checkpoints.length} checkpoint${checkpoints.length === 1 ? "" : "s"} (newest first):`, ...lines].join("\n");
}

/** Model-facing save confirmation. */
export function formatSavedText(checkpoint: Checkpoint): string {
	return `Saved checkpoint #${checkpoint.id} (${reasonLabel(checkpoint)}). Restore it from the /checkpoint menu.`;
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

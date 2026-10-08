/**
 * Pure text formatting for the rewind extension.
 *
 * No terminal access and no theme: these turn prompts, restore summaries, and
 * diffs into the short strings the command notice and the timeline renderer
 * show.
 */

import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitize } from "../_shared/format.ts";
import type { RestoreSummary } from "./types.ts";

/** Longest prompt summary shown before truncation. */
const LABEL_WIDTH = 48;

/** Longest stored prompt summary, so metadata commits stay small. */
export const PROMPT_WIDTH = 100;

/** Lines of diff shown in a notice before eliding. */
const DIFF_PREVIEW_LINES = 20;

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

/** `2 files changed, 1 created` for a diff or restore preview. */
export function formatChangeSummary(changed: number, removed: number): string {
	const changedText = `${changed} file${changed === 1 ? "" : "s"} changed`;
	return removed > 0 ? `${changedText}, ${removed} created` : changedText;
}

/**
 * Id-free row for the rewind timeline: `↺ "prompt"          2m ago`.
 * The leading glyph marks a point with a code snapshot; the time is
 * right-aligned so the whole row never exceeds `width`.
 */
export function formatRewindRow(
	summary: string | undefined,
	hasSnapshot: boolean,
	timestamp: number,
	now = Date.now(),
	width = 80,
): string {
	const prefix = hasSnapshot ? "↺ " : "  ";
	const suffix = `  ${formatRelativeTime(timestamp, now)}`;
	const available = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix));
	const label = truncate(sanitize(summary || "(no text)"), available);
	const gap = Math.max(1, width - visibleWidth(prefix) - visibleWidth(label) - visibleWidth(suffix));
	return truncateToWidth(`${prefix}${label}${" ".repeat(gap)}${suffix}`, width);
}

/** Focused-row detail: whether code is snapshotted at this point. */
export function formatRewindDetail(hasSnapshot: boolean, snapshotId?: string): string {
	if (!hasSnapshot) return "conversation only";
	return snapshotId ? `code snapshot #${snapshotId}` : "code snapshot";
}

/** Headless list text for `/rewind` in modes without a picker. */
export function formatRewindListText(
	points: ReadonlyArray<{ summary: string | undefined; timestamp: number; hasSnapshot: boolean }>,
	now = Date.now(),
): string {
	if (points.length === 0) return "No prompts to rewind to yet.";
	const lines = points.map((point) => formatRewindRow(point.summary, point.hasSnapshot, point.timestamp, now));
	return [`${points.length} prompt${points.length === 1 ? "" : "s"} (newest first):`, ...lines].join("\n");
}

/** Bounded diff preview for a confirm dialog or notice. */
export function previewDiffText(diff: string, maxLines = DIFF_PREVIEW_LINES): string {
	const lines = diff.split("\n");
	if (lines.length <= maxLines) return diff;
	return [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines`].join("\n");
}

/** Restore confirmation text. */
export function formatRestoreText(summary: RestoreSummary): string {
	const parts = [`Restored snapshot #${summary.id}: ${summary.changed} file${summary.changed === 1 ? "" : "s"} changed`];
	if (summary.removed > 0) parts.push(`${summary.removed} removed`);
	const line = `${parts.join(", ")}.`;
	const safety = summary.safety ? ` A safety snapshot #${summary.safety} captures the pre-restore state.` : "";
	return `${line}${safety}`;
}

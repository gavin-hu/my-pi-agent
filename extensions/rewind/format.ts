/**
 * Pure text formatting for the rewind extension.
 *
 * No terminal access and no theme: these turn prompts, restore summaries, and
 * diffs into the short strings the command notice and the timeline renderer
 * show.
 */

import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeLine, stripControlChars } from "../../lib/format.ts";
import { GLYPHS, SEPARATORS } from "../../lib/tui/glyphs.ts";
import { SELECTION_MARKS, type ReviewEntry } from "./paths.ts";
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
 *
 * A run started by a custom message (a wake) has no user prompt: `event.prompt`
 * is typed `string` but is `undefined` there, so a missing prompt is accepted
 * and yields no summary rather than throwing.
 */
export function summarizePrompt(text: string | undefined): string | undefined {
	if (typeof text !== "string") return undefined;
	const line = text
		.split(/\r?\n/)
		.map((part) => sanitizeLine(part))
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

/** The parts of one timeline row, for the shared list-row grammar. */
export interface RewindRowParts {
	/** The `⬥` snapshot marker, or a blank to keep the label column aligned. */
	glyph: string;
	/** The sanitized prompt summary. */
	label: string;
	/** The right-aligned relative time. */
	trailing: string;
}

/**
 * The timeline row's parts, composed by the screen through `listRow`.
 * `formatRewindRow` below stays the plain-text form the headless listing uses;
 * the screen wants the marker, colors, and column math of the shared grammar.
 */
export function formatRewindParts(
	summary: string | undefined,
	hasSnapshot: boolean,
	timestamp: number,
	now = Date.now(),
): RewindRowParts {
	return {
		glyph: hasSnapshot ? GLYPHS.snapshot : " ",
		label: sanitizeLine(summary || "(no text)"),
		trailing: formatRelativeTime(timestamp, now),
	};
}

/**
 * Id-free row for the rewind timeline: `⬥ "prompt"          2m ago`.
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
	const prefix = hasSnapshot ? `${GLYPHS.snapshot} ` : "  ";
	const suffix = `  ${formatRelativeTime(timestamp, now)}`;
	const available = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix));
	const label = truncate(sanitizeLine(summary || "(no text)"), available);
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

/** Restore confirmation text; a partial restore also names how much it covered. */
export function formatRestoreText(summary: RestoreSummary): string {
	const scope = summary.of === undefined ? "" : ` of ${summary.of}`;
	const files = `${summary.changed}${scope} file${summary.changed === 1 && summary.of === undefined ? "" : "s"}`;
	const parts = [`Restored snapshot #${summary.id}: ${files} changed`];
	if (summary.removed > 0) parts.push(`${summary.removed} removed`);
	const line = `${parts.join(", ")}.`;
	const safety = summary.safety ? ` A safety snapshot #${summary.safety} captures the pre-restore state.` : "";
	return `${line}${safety}`;
}

/** The trailing `+n −n`, `bin`, or `0` for one review row. */
export function formatReviewEntryCounts(entry: Pick<ReviewEntry, "added" | "removed">): string {
	if (entry.added === null && entry.removed === null) return "bin";
	const parts: string[] = [];
	if (entry.added !== null && entry.added > 0) parts.push(`+${entry.added}`);
	if (entry.removed !== null && entry.removed > 0) parts.push(`−${entry.removed}`);
	return parts.length > 0 ? parts.join(" ") : "0";
}

/** The review list's summary: `4 files · +128 −19`, plus `N selected` and `bin` when needed. */
export function formatReviewSummary(entries: readonly ReviewEntry[], selected = 0): string {
	const files = `${entries.length} file${entries.length === 1 ? "" : "s"}`;
	let added = 0;
	let removed = 0;
	let binary = false;
	for (const entry of entries) {
		if (entry.added === null && entry.removed === null) binary = true;
		else {
			added += entry.added ?? 0;
			removed += entry.removed ?? 0;
		}
	}
	const parts = [files];
	if (added > 0 || removed > 0) parts.push(`+${added} −${removed}`);
	if (binary) parts.push("bin");
	if (selected > 0) parts.push(`${selected} selected`);
	return parts.join(SEPARATORS.item);
}

/** The sanitized snapshot-side name of a rename, or undefined for any other row. */
function renameFrom(entry: ReviewEntry): string | undefined {
	return entry.change === "renamed" ? sanitizeLine(entry.from) : undefined;
}

/** How a review change kind reads in a detail line or a confirmation. */
function changeDescription(entry: ReviewEntry): string {
	if (entry.change === "added") return "created after the snapshot; reverting deletes it";
	if (entry.change === "deleted") return "deleted since the snapshot; reverting brings it back";
	const from = renameFrom(entry);
	return from === undefined
		? "modified since the snapshot; reverting rewrites it"
		: `renamed from ${from}; reverting moves it back`;
}

/**
 * What the focused review row will do, in words.
 *
 * The keys are the hint row's job: a detail line long enough to repeat them is
 * clipped mid-sentence at the widths the screen runs at.
 */
export function formatReviewDetail(entry: ReviewEntry): string {
	return `${SELECTION_MARKS[entry.change]} — ${changeDescription(entry)}${SEPARATORS.item}${formatReviewEntryCounts(entry)}.`;
}

/** Headless `/review` text for modes without a custom screen. */
export function formatReviewListText(
	entries: readonly ReviewEntry[],
	prompt: string | undefined,
	committed = false,
): string {
	const label = summarizePrompt(prompt) ?? "the last prompt";
	const rows = entries.map((entry) => {
		const counts = formatReviewEntryCounts(entry);
		const from = renameFrom(entry);
		const name = from === undefined ? sanitizeLine(entry.path) : `${sanitizeLine(entry.path)} (from ${from})`;
		return `  ${SELECTION_MARKS[entry.change]} ${name}${counts ? `  ${counts}` : ""}`;
	});
	const files = `${entries.length} file${entries.length === 1 ? "" : "s"}`;
	const note = committed ? ["These changes are already committed; reverting rewrites the working tree only."] : [];
	return [`Reviewing after "${label}" (${files}):`, ...rows, ...note].join("\n");
}

/** What one review revert did, and what is left to review. */
export function formatReviewRevertText(summary: RestoreSummary, remaining: number): string {
	const count = summary.changed + summary.removed;
	const files = `${count} file${count === 1 ? "" : "s"}`;
	const safety = summary.safety ? ` Safety snapshot #${summary.safety}.` : "";
	const left =
		remaining === 0 ? " No changes remain." : ` ${remaining} file${remaining === 1 ? "" : "s"} still changed.`;
	return `Reverted ${files}.${safety}${left}`;
}

/** What a revert does to HEAD and the index, with the committed case named. */
function headNote(committed: boolean): string {
	return committed
		? "These changes are already committed; reverting rewrites the working tree and leaves the commits in place. HEAD and the index are untouched."
		: "HEAD and the index are untouched.";
}

/** The confirmation body for reverting one file. */
export function formatRevertOneBody(entry: ReviewEntry, prompt: string, safety: boolean, committed = false): string {
	const label = summarizePrompt(prompt) ?? "this prompt";
	const counts =
		entry.added === null && entry.removed === null
			? "Git reports a binary change; the whole file is restored."
			: `Diff: ${formatReviewEntryCounts(entry)}.`;
	const from = renameFrom(entry);
	const target =
		from === undefined
			? `Returns ${sanitizeLine(entry.path)} to the snapshot taken before "${label}".`
			: `Moves ${sanitizeLine(entry.path)} back to ${from} as it was before "${label}".`;
	return [
		`${SELECTION_MARKS[entry.change]} — ${changeDescription(entry)}.`,
		counts,
		"",
		target,
		headNote(committed),
		safety
			? "A safety snapshot first makes the revert undoable with /rewind."
			: "Safety snapshots are off; this cannot be undone.",
	].join("\n");
}

/** The confirmation body for reverting every changed path in the review. */
export function formatRevertAllBody(
	entries: readonly ReviewEntry[],
	prompt: string,
	safety: boolean,
	committed = false,
): string {
	const label = summarizePrompt(prompt) ?? "this prompt";
	const files = `${entries.length} file${entries.length === 1 ? "" : "s"}`;
	return [
		`Restores ${files} to the snapshot taken before "${label}".`,
		formatReviewSummary(entries),
		headNote(committed),
		safety
			? "A safety snapshot first makes the revert undoable with /rewind."
			: "Safety snapshots are off; this cannot be undone.",
	].join("\n");
}

/** The confirmation body for reverting a chosen subset. */
export function formatRevertSelectedBody(
	entries: readonly ReviewEntry[],
	prompt: string,
	safety: boolean,
	committed = false,
): string {
	const label = summarizePrompt(prompt) ?? "this prompt";
	const selected = `${entries.length} selected file${entries.length === 1 ? "" : "s"}`;
	return [
		`Restores ${selected} to the snapshot taken before "${label}".`,
		"Other changed files stay as they are.",
		formatReviewSummary(entries),
		headNote(committed),
		safety
			? "A safety snapshot first makes the revert undoable with /rewind."
			: "Safety snapshots are off; this cannot be undone.",
	].join("\n");
}

/** The confirmation body for reverting chosen hunks of one file. */
export function formatHunkRevertBody(
	entry: ReviewEntry,
	selected: number,
	total: number,
	prompt: string,
	safety: boolean,
	committed = false,
): string {
	const label = summarizePrompt(prompt) ?? "this prompt";
	const rest = total - selected;
	return [
		`Reverts ${selected} of ${total} hunk${total === 1 ? "" : "s"} in ${sanitizeLine(entry.path)} to the snapshot taken before "${label}".`,
		rest > 0
			? `${rest} hunk${rest === 1 ? "" : "s"} in the file stay${rest === 1 ? "s" : ""} as ${rest === 1 ? "it is" : "they are"}.`
			: "Every hunk in the file is reverted.",
		headNote(committed),
		safety
			? "A safety snapshot first makes the revert undoable with /rewind."
			: "Safety snapshots are off; this cannot be undone.",
	].join("\n");
}

/** What a hunk revert did, and what is left to review. */
export function formatHunkRevertText(
	path: string,
	hunks: number,
	safety: string | undefined,
	remaining: number,
): string {
	const files = `${hunks} hunk${hunks === 1 ? "" : "s"} in ${sanitizeLine(path)}`;
	const safetyText = safety ? ` Safety snapshot #${safety}.` : "";
	const left =
		remaining === 0 ? " No changes remain." : ` ${remaining} file${remaining === 1 ? "" : "s"} still changed.`;
	return `Reverted ${files}.${safetyText}${left}`;
}

/** Lines of one review diff shown at most. */
export const REVIEW_DIFF_MAX_LINES = 2_000;

/** Characters of one review diff kept before the line cap applies. */
export const REVIEW_DIFF_MAX_CHARS = 400_000;

/**
 * A review patch as display lines: sanitized, tab-expanded, and bounded.
 *
 * The cap is applied before the pane ever holds the buffer, so a generated or
 * minified file cannot make the screen allocate its whole diff. A truncated
 * buffer ends with a note, and an empty patch (a binary change git would not
 * render) gets a one-line placeholder instead of an empty screen.
 */
export function boundDiff(text: string, maxLines = REVIEW_DIFF_MAX_LINES, maxChars = REVIEW_DIFF_MAX_CHARS): string[] {
	if (text.trim() === "") return ["No textual diff."];
	const truncatedByChars = text.length > maxChars;
	const raw = (truncatedByChars ? text.slice(0, maxChars) : text).split(/\r?\n/);
	if (raw.at(-1) === "") raw.pop();
	// A diff keeps its indentation, so this uses the multi-line boundary and
	// expands tabs itself; `sanitizeLine` would collapse both.
	const lines = raw.map((line) => stripControlChars(line).replaceAll("\t", "    "));
	if (!truncatedByChars && lines.length <= maxLines) return lines;
	const kept = lines.slice(0, maxLines);
	kept.push(truncatedByChars ? "… diff truncated" : `… diff truncated at ${maxLines} lines`);
	return kept;
}

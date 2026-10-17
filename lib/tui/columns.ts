/**
 * Width arithmetic for the terminal: justify, fit, pad, and clip lines.
 *
 * Every function works in terminal columns via `visibleWidth` /
 * `truncateToWidth`, never string length, and every result fits the width it
 * was given. Themed strings pass through unchanged except where a cell has to
 * be clipped, so a color survives every cell that fits.
 *
 * Value-only: pure functions over their arguments.
 */

import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** A usable origin: terminal arithmetic starts from one column, never zero. */
function columns(width: number): number {
	return Math.max(1, Math.floor(width));
}

/** Clip a possibly-themed string to `width` columns, marking a cut with `ellipsis`. */
export function clip(text: string, width: number, ellipsis = "…"): string {
	return truncateToWidth(text, columns(width), ellipsis);
}

/**
 * Clip from the middle, keeping both ends: `example.com/…/retry-policy`.
 *
 * Use it when the tail carries the identity (a path's basename, a URL's path)
 * and the head carries the context (a host, a directory). Prose should use
 * {@link clip} instead, because its opening words matter more than its tail.
 * A themed string keeps its colours on both the head and the tail.
 */
export function clipMiddle(text: string, width: number, ellipsis = "…"): string {
	const w = columns(width);
	if (visibleWidth(text) <= w) return text;
	const ellipsisWidth = visibleWidth(ellipsis);
	const budget = w - ellipsisWidth;
	if (budget <= 0) return clip(text, w, ellipsis);

	// One more column for the head, so an odd budget leaves the longer half where
	// the eye starts; the tail is sliced by grapheme, never split.
	const headWidth = Math.ceil(budget / 2);
	const tailWidth = budget - headWidth;
	const head = truncateToWidth(text, headWidth, "");
	const tail = tailWidth > 0 ? sliceByColumn(text, visibleWidth(text) - tailWidth, tailWidth, true) : "";
	return clip(`${head}${ellipsis}${tail}`, w, ellipsis);
}

/** Pad `text` on the right to exactly `width` columns. Never truncates. */
export function padTo(text: string, width: number): string {
	const missing = columns(width) - visibleWidth(text);
	return missing > 0 ? text + " ".repeat(missing) : text;
}

/**
 * Left/right justify on one line: the left cell sits at the margin, the right
 * cell at the edge, and at least `minGap` columns separate them.
 *
 * The right cell is the anchor — it is clipped only after the left cell has
 * been clipped away — so a value at the end of a line (a model name, a metric)
 * survives a tight terminal instead of vanishing. An empty right cell means a
 * plain left-aligned line with no trailing spaces.
 */
export function splitRow(left: string, right: string, width: number, minGap = 1): string {
	const w = columns(width);
	if (!right) return clip(left, w);
	const gap = Math.max(0, Math.floor(minGap));
	const rightCell = clip(right, w);
	const rightWidth = visibleWidth(rightCell);
	const leftBudget = w - rightWidth - gap;
	if (leftBudget <= 0) return rightCell;
	return padTo(clip(left, leftBudget), w - rightWidth) + rightCell;
}

/**
 * Join as many whole cells as fit, dropping trailing cells rather than
 * clipping one in half. The first cell is always kept, so an over-wide line
 * degrades to a clipped first cell instead of an empty one.
 */
export function fitCells(cells: readonly string[], width: number, separator = " "): string {
	const w = columns(width);
	const kept: string[] = [];
	for (const cell of cells) {
		const candidate = [...kept, cell].join(separator);
		if (kept.length > 0 && visibleWidth(candidate) > w) break;
		kept.push(cell);
	}
	return clip(kept.join(separator), w);
}

/**
 * Lay atomic, already-themed cells onto lines no wider than `width`.
 *
 * Cells are never split: one that would not fit moves to the next line, and one
 * wider than the whole width is clipped. Use this for a row of independent
 * tokens (tabs, tags) where `fitCells`' single-line drop would lose one; unlike
 * {@link fitCells} it may return several lines, and always returns one.
 */
export function flowCells(cells: readonly string[], width: number): string[] {
	const w = columns(width);
	const lines: string[] = [];
	let current = "";
	let currentWidth = 0;
	for (const cell of cells) {
		let text = cell;
		let cellWidth = visibleWidth(cell);
		if (cellWidth > w) {
			text = truncateToWidth(cell, w);
			cellWidth = visibleWidth(text);
		}
		if (currentWidth > 0 && currentWidth + cellWidth > w) {
			lines.push(current);
			current = "";
			currentWidth = 0;
		}
		current += text;
		currentWidth += cellWidth;
	}
	lines.push(current);
	return lines;
}

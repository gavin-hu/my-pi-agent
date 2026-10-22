/**
 * The strict shape match for the next-steps block.
 *
 * The model writes a block as the last thing in its reply; everything here
 * decides whether that text really is one. It is deliberately unforgiving: a
 * reply that merely mentions "Next:", a marker inside a fenced example, a block
 * with one item, or a block followed by more prose is left exactly as written.
 * Two consumers share the one parse — the entry writer (which keeps the items)
 * and the transcript transformer (which drops the block from the reply so it is
 * drawn once, below the turn rule).
 */

import { sanitizeLine } from "../../../lib/format.ts";
import { isBlank } from "../../../lib/tui/indent.ts";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** The exact marker line that opens a block. */
const MARKER = /^Next:\s*$/;
/** A list item: a bullet or a number, a space, then the text. */
const ITEM = /^(?:[-*]|\d+[.)])\s+(.+)$/;
/** A fenced-code delimiter. */
const FENCE = /^\s*(?:```|~~~)/;
/** A list needs at least this many items; one option is prose, not a list. */
const MIN_ITEMS = 2;
/** Items kept: the instruction asks for two or three. */
const MAX_ITEMS = 3;
/** Longest item kept, in terminal columns. */
export const MAX_ITEM_COLUMNS = 120;

/** A parsed block: the items to draw, and the reply without the block. */
export interface ParsedNextSteps {
	/** Two or three item texts, sanitized, clipped, markers and numbering dropped. */
	items: string[];
	/** The reply with the block (and the blank lines before it) removed. */
	stripped: string;
}

/** The last run of non-blank lines in `lines`, as a half-open range. */
function lastBlock(lines: readonly string[]): { start: number; end: number } {
	let end = lines.length;
	while (end > 0 && isBlank(lines[end - 1] ?? "")) end--;
	let start = end;
	while (start > 0 && !isBlank(lines[start - 1] ?? "")) start--;
	return { start, end };
}

/** Whether the line at `index` sits inside an open code fence. */
function insideFence(lines: readonly string[], index: number): boolean {
	let open = false;
	for (let i = 0; i < index; i++) {
		if (FENCE.test(lines[i] ?? "")) open = !open;
	}
	return open;
}

/**
 * One item's text as a single sanitized row, clipped rather than wrapped.
 * `truncateToWidth` closes a clipped line with a reset sequence, which has no
 * place in stored entry data, so the result is stripped back to plain text.
 */
function itemText(raw: string): string {
	const clean = sanitizeLine(raw);
	const clipped = visibleWidth(clean) > MAX_ITEM_COLUMNS ? truncateToWidth(clean, MAX_ITEM_COLUMNS, "…") : clean;
	return stripTerminalSequences(clipped);
}

/**
 * Read the reply's final block as next steps, or `undefined` when it is anything
 * else. `stripped` is the reply minus that block, which is what the transcript
 * shows so the items appear once, in their own aside.
 */
export function parseNextSteps(reply: string): ParsedNextSteps | undefined {
	if (reply.trim() === "") return undefined;
	// Normalize CRLF first: `.` does not match `\r`, so item lines would otherwise fail.
	const lines = reply.replace(/\r\n?/g, "\n").split("\n");
	const { start, end } = lastBlock(lines);
	if (end - start < MIN_ITEMS + 1) return undefined;
	if (!MARKER.test(lines[start] ?? "")) return undefined;
	if (insideFence(lines, start)) return undefined;

	const items: string[] = [];
	for (const line of lines.slice(start + 1, end)) {
		const match = ITEM.exec(line);
		if (!match) return undefined;
		const text = itemText(match[1] ?? "");
		if (text !== "") items.push(text);
	}
	if (items.length < MIN_ITEMS) return undefined;

	const before = lines.slice(0, start);
	while (before.length > 0 && isBlank(before[before.length - 1] ?? "")) before.pop();
	return { items: items.slice(0, MAX_ITEMS), stripped: before.join("\n") };
}

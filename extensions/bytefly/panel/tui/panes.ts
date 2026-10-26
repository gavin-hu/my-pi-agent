/**
 * The two-pane split: where the side pane starts, how wide each side is, and how
 * one row of each is laid on one terminal line.
 *
 * Above the breakpoint the focused row's facts sit beside the list; below it the
 * frame keeps the single column and the facts move under the list. The side lines
 * are *composed onto* the list's lines rather than appended, so the two panes cost
 * exactly the rows the list already spends — the frame's row budget is the same at
 * every width.
 *
 * Value-only: pure functions, the theme passed in.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { clip, padTo } from "../../../../lib/tui/columns.ts";
import { GLYPHS } from "../../../../lib/tui/glyphs.ts";
import { paint } from "../../../../lib/tui/tokens.ts";

/** The narrowest terminal that gets a side pane. */
export const WIDE_MIN = 96;

/** The side pane's width bounds, in columns. */
export const SIDE_MIN = 36;
export const SIDE_MAX = 56;

/** Columns between the list and the side pane, on each side of the divider. */
const GAP = 1;

/** Whether this width gets a side pane. */
export function isWide(width: number): boolean {
	return width >= WIDE_MIN;
}

/**
 * The side pane's width: two fifths of the terminal, clamped. Reading the list
 * and its facts at the same height is the point, so the side never grows past
 * what keeps a row and its verdict readable on the left.
 */
export function sideWidth(width: number): number {
	return Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.floor(width * 0.42)));
}

/** The columns the list keeps, divider and gaps included in the accounting. */
export function listWidth(width: number): number {
	return Math.max(1, width - sideWidth(width) - GAP * 2 - 1);
}

/**
 * Compose one line pair: the list row padded to its column, the divider, and the
 * side row. A pair with no side content still draws the divider, so the pane keeps
 * one edge down the body instead of appearing and disappearing row by row.
 */
export function composeRow(theme: Theme, width: number, list: string, side: string): string {
	const left = padTo(clip(list, listWidth(width)), listWidth(width));
	const divider = paint(theme, "rule", GLYPHS.divider);
	const room = Math.max(0, width - listWidth(width) - GAP * 2 - 1);
	return clip(`${left}${" ".repeat(GAP)}${divider}${" ".repeat(GAP)}${clip(side, room)}`, width);
}

/** Compose a body of list rows with a side pane, one line pair per row. */
export function composeRows(theme: Theme, width: number, list: readonly string[], side: readonly string[]): string[] {
	return list.map((line, index) => composeRow(theme, width, line, side[index] ?? ""));
}

/**
 * Cut the side block to the rows it has, keeping the reader informed: the last row
 * says how many lines are left out, which is the same convention the JSON pane uses.
 */
export function clipRows(rows: readonly string[], budget: number, width: number): string[] {
	const room = Math.max(0, Math.floor(budget));
	if (rows.length <= room) return [...rows];
	if (room === 0) return [];
	const kept = rows.slice(0, room - 1);
	const hidden = rows.length - kept.length;
	return [...kept, clip(`… ${hidden} more line${hidden === 1 ? "" : "s"}`, width)];
}

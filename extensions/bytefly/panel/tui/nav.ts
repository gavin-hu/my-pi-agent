/**
 * Cursor arithmetic for the panel's two lists: keep the focus on a row across a
 * rebuild, land on the nearest row when the shape changes, and move by rows
 * while skipping group headers.
 *
 * Pure: each function takes the entries and the cursor and mutates only the
 * cursor it was handed, so the component keeps one cursor per section and no
 * navigation state of its own.
 */

import type { ListCursor } from "../../../../lib/tui/cursor.ts";
import { entryKey, isSelectable, nextRow, type PanelEntry } from "./entries.ts";

/** The first selectable entry, or `undefined` when the list has none. */
export function firstRow(entries: PanelEntry[]): number | undefined {
	const index = entries.findIndex(isSelectable);
	return index >= 0 ? index : undefined;
}

/** The last selectable entry, or `undefined` when the list has none. */
export function lastRow(entries: PanelEntry[]): number | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		if (isSelectable(entries[index])) return index;
	}
	return undefined;
}

/** Keep the focus on the same row key when the list shape changes. */
export function retainFocus(entries: PanelEntry[], cursor: ListCursor, remembered: string | undefined): void {
	const key = entryKey(entries[cursor.selected]);
	if (key !== undefined) return;
	if (remembered === undefined) return;
	const index = entries.findIndex((candidate) => entryKey(candidate) === remembered);
	if (index >= 0) cursor.selected = index;
}

/** Move onto the nearest selectable row when the focus is not already on one. */
export function clampSelection(entries: PanelEntry[], cursor: ListCursor): void {
	if (entries.length === 0) return;
	const index = Math.min(Math.max(0, cursor.selected), entries.length - 1);
	if (isSelectable(entries[index])) {
		cursor.selected = index;
		return;
	}
	// Prefer the closest row above, then the closest below, so a scope switch that
	// drops the focused row leaves the cursor nearby instead of at the top.
	for (let back = index - 1; back >= 0; back -= 1) {
		if (isSelectable(entries[back])) {
			cursor.selected = back;
			return;
		}
	}
	for (let forward = index + 1; forward < entries.length; forward += 1) {
		if (isSelectable(entries[forward])) {
			cursor.selected = forward;
			return;
		}
	}
}

/** Move `delta` rows from the cursor, skipping group headers. */
export function moveRows(entries: PanelEntry[], cursor: ListCursor, delta: number): void {
	if (delta === 0) return;
	clampSelection(entries, cursor);
	const direction = delta < 0 ? -1 : 1;
	let index = cursor.selected;
	let remaining = Math.abs(delta);
	while (remaining > 0) {
		const next = nextRow(entries, index, direction);
		if (next === undefined) break;
		index = next;
		remaining -= 1;
	}
	cursor.set(index, entries.length);
}

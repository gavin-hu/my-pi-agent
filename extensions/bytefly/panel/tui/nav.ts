/**
 * Cursor arithmetic for the panel's lists: keep the focus on a row across a
 * rebuild, land on the nearest row when the shape changes, move by rows while
 * skipping group headers, and read one navigation key.
 *
 * Pure: each function takes the entries and the cursor and mutates only the
 * cursor it was handed, so the component keeps one cursor per section and no
 * navigation state of its own.
 */

import type { ListCursor } from "../../../../lib/tui/cursor.ts";
import { navIntent } from "../../../../lib/tui/cursor.ts";
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

/** Move to the first row of the next (or previous) group. */
export function jumpGroup(entries: PanelEntry[], cursor: ListCursor, direction: -1 | 1): void {
	const headers = entries.flatMap((entry, index) => (entry.kind === "group" ? [index] : []));
	const selected = cursor.selected;
	// Step past the focused row's own header: landing on it would not move.
	const own = headers.filter((index) => index < selected).at(-1);
	const target =
		direction === 1 ? headers.find((index) => index > selected) : headers.filter((index) => index < (own ?? 0)).at(-1);
	if (target === undefined) return;
	for (let index = target + 1; index < entries.length; index += 1) {
		if (isSelectable(entries[index])) {
			cursor.set(index, entries.length);
			return;
		}
	}
}

/** Move the cursor to `index`, clamped to the list. */
export function selectRow(entries: PanelEntry[], cursor: ListCursor, index: number | undefined): void {
	if (index === undefined) return;
	cursor.set(index, entries.length);
}

/**
 * Read one navigation key against a list. `grouped` is true for the resource
 * lists, whose headings the bracket keys jump between; the Settings list is flat.
 */
export function navigateEntries(
	entries: PanelEntry[],
	cursor: ListCursor,
	data: string,
	options: { grouped: boolean },
): void {
	if (data === "g") {
		selectRow(entries, cursor, firstRow(entries));
		return;
	}
	if (data === "G") {
		selectRow(entries, cursor, lastRow(entries));
		return;
	}
	if (options.grouped && (data === "[" || data === "]")) {
		jumpGroup(entries, cursor, data === "[" ? -1 : 1);
		return;
	}
	switch (navIntent(data)) {
		case "up":
			moveRows(entries, cursor, -1);
			return;
		case "down":
			moveRows(entries, cursor, 1);
			return;
		case "pageUp":
			moveRows(entries, cursor, -Math.max(1, cursor.visible));
			return;
		case "pageDown":
			moveRows(entries, cursor, Math.max(1, cursor.visible));
			return;
		case "home":
			selectRow(entries, cursor, firstRow(entries));
			return;
		case "end":
			selectRow(entries, cursor, lastRow(entries));
			return;
	}
}

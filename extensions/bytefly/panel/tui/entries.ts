/**
 * The panel's entry model: one flat list of selectable rows per section.
 *
 * Extensions interleaves group headings with rows — a source group says where a
 * resource came from, which the row cannot — while Settings is flat, in catalogue
 * order. Both are built from a model or a set of views, so the component only has
 * to keep one cursor per section.
 *
 * Pure: the list is rebuilt from a model or a set of views, and navigation is
 * index arithmetic.
 */

import type { SettingView } from "../settings.ts";
import type { PanelModel, PanelRow } from "../types.ts";

/** A flat display entry: a group header or a selectable row. */
export type PanelEntry =
	| { kind: "group"; key: string; label: string; count: number }
	| { kind: "row"; row: PanelRow }
	| { kind: "setting"; setting: SettingView };

/** A selectable entry's stable key, or `undefined` for a group header. */
export function entryKey(entry: PanelEntry | undefined): string | undefined {
	if (entry?.kind === "row") return entry.row.key;
	if (entry?.kind === "setting") return entry.setting.id;
	return undefined;
}

/** Whether an entry can take the focus. */
export function isSelectable(entry: PanelEntry | undefined): boolean {
	return entryKey(entry) !== undefined;
}

/**
 * One display window as ordinals over the selectable rows it contains.
 *
 * The range row counts rows, not entries: an extension list's group headings are
 * not focusable, so `showing 3–5 of 12` is what the user can land on.
 * `formatRange` prints `start + 1` through `end`, so the ordinals here are
 * zero-based and `end` is exclusive.
 */
export function selectableRange(
	entries: readonly PanelEntry[],
	window: { start: number; end: number },
): { start: number; end: number; total: number } {
	let before = 0;
	let shown = 0;
	let total = 0;
	for (let index = 0; index < entries.length; index += 1) {
		if (!isSelectable(entries[index])) continue;
		total += 1;
		if (index < window.start) before += 1;
		else if (index < window.end) shown += 1;
	}
	return { start: before, end: before + shown, total };
}

/** The next selectable entry from `from` in `direction`, or `undefined`. */
export function nextRow(entries: PanelEntry[], from: number, direction: -1 | 1): number | undefined {
	for (let index = from + direction; index >= 0 && index < entries.length; index += direction) {
		if (isSelectable(entries[index])) return index;
	}
	return undefined;
}

/** Interleave the extension model's groups and rows into one display list. */
export function entriesOf(model: PanelModel): PanelEntry[] {
	const entries: PanelEntry[] = [];
	for (const group of model.groups) {
		entries.push({ kind: "group", key: group.key, label: group.label, count: group.count });
		for (const row of model.rows) {
			if (row.group === group.key) entries.push({ kind: "row", row });
		}
	}
	return entries;
}

/**
 * The Settings entries: one row per view, in catalogue order, with no group
 * headings — the list is short enough to read whole.
 */
export function settingEntries(views: readonly SettingView[]): PanelEntry[] {
	return views.map((setting) => ({ kind: "setting", setting }));
}

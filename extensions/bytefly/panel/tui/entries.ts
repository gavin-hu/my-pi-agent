/**
 * The panel's entry model: a flat list where group headers and selectable rows
 * interleave, shared by both sections.
 *
 * Pure: the list is rebuilt from a model or a set of views, and navigation is
 * index arithmetic, so the component only has to keep one cursor per section.
 */

import { groupViews, type SettingView } from "../settings.ts";
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

/** Interleave the settings views into the same group/row display list. */
export function settingEntries(views: readonly SettingView[]): PanelEntry[] {
	const entries: PanelEntry[] = [];
	for (const group of groupViews(views)) {
		entries.push({ kind: "group", key: group.key, label: group.label, count: group.views.length });
		for (const view of group.views) entries.push({ kind: "setting", setting: view });
	}
	return entries;
}

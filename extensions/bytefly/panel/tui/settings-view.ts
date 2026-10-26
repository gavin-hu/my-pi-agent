/**
 * The Settings section's rows and the two words only it says.
 *
 * A row is a checkbox for a boolean, the label, and the value in a column of its
 * own — the column is what makes twelve values scannable, and it is measured from
 * the labels actually on screen rather than from the longest label in the
 * catalogue, so a narrow terminal keeps the value instead of the padding.
 *
 * Pure: pure functions over the catalogue's views, theme passed in.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../../../lib/format.ts";
import { clip, padTo } from "../../../../lib/tui/columns.ts";
import { checkbox, listRow } from "../../../../lib/tui/rows.ts";
import { paint } from "../../../../lib/tui/tokens.ts";
import type { SettingView } from "../settings.ts";
import { INDENT } from "./frame.ts";

/** Columns the marker and the leading cell take before the label. */
const ROW_PREFIX_WIDTH = 4;
/** Columns a value keeps when the row has to choose between the label and the value. */
const MIN_VALUE_WIDTH = 8;
/** Columns between the label column and its value. */
const VALUE_GAP = 2;

/**
 * The editing cell: the buffer around the caret, scrolled so the caret is always
 * visible, with ellipses where text is off-screen. The cell fits `budget`
 * columns, so a long buffer cannot push the label out of the row.
 */
function editingCell(buffer: string, caret: number, budget: number): string {
	const width = Math.max(1, budget);
	const before = buffer.slice(0, caret);
	const beforeWidth = visibleWidth(before);
	const caretRoom = width - 1;
	if (beforeWidth > caretRoom) {
		// Reserve one column for the leading ellipsis; the caret sits at the right edge.
		const shownWidth = Math.max(0, caretRoom - 1);
		const prefix = shownWidth > 0 ? "…" : "";
		const shown = shownWidth > 0 ? sliceByColumn(before, beforeWidth - shownWidth, shownWidth, true) : "";
		return `${prefix}${shown}▏`;
	}
	const used = beforeWidth + 1;
	const afterRoom = Math.max(0, width - used);
	const after = afterRoom > 0 ? truncateToWidth(buffer.slice(caret), afterRoom, "…") : "";
	return `${before}▏${after}`;
}

/**
 * The label column: the widest label on screen, capped so a value always keeps
 * `MIN_VALUE_WIDTH` columns and a long label is clipped rather than the value
 * pushed off the row.
 */
export function settingLabelColumn(views: readonly SettingView[], width: number): number {
	const widest = views.reduce((columns, view) => Math.max(columns, visibleWidth(sanitizeLine(view.label))), 0);
	const room = Math.max(0, width - ROW_PREFIX_WIDTH - VALUE_GAP - MIN_VALUE_WIDTH);
	return Math.max(0, Math.min(widest, room));
}

/** One setting row: a checkbox for a boolean, the label, and the value in its column. */
export function settingRow(
	theme: Theme,
	width: number,
	view: SettingView,
	selected: boolean,
	editing: { buffer: string; caret: number } | undefined,
	labelColumn: number,
): string {
	const label = sanitizeLine(view.label);
	const available = Math.max(1, width - ROW_PREFIX_WIDTH - VALUE_GAP - labelColumn);
	const rawValue = editing ? editingCell(editing.buffer, editing.caret, available) : view.valueLabel;
	return listRow(theme, width, {
		selected,
		leading: view.kind === "boolean" ? checkbox(theme, view.value === "true") : " ",
		label: padTo(label, labelColumn),
		labelRole: selected ? "accent" : "label",
		trailing: clip(sanitizeLine(rawValue), available),
		trailingRole: editing ? "accent" : "meta",
		// The value sits in its own column rather than at the far edge, so a wide
		// terminal does not put the label and its value at opposite ends of the row.
		align: "inline",
	});
}

/** The project note: app rows are absent because Pi has no project setter. */
export function projectNote(theme: Theme, width: number): string {
	return clip(`${INDENT}${paint(theme, "faint", "App settings are Global only.")}`, Math.max(1, width));
}

/** The editor's key hints: `Esc` cancels the edit, it does not close the screen. */
export function editHints(): string[] {
	return ["Esc cancel", "←/→ caret", "Enter save", "Backspace delete", "Ctrl+U clear"];
}

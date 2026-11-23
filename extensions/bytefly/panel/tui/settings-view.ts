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
/** Columns the `· Global` tag takes, including the gap before it. */
const TAG_WIDTH = 9;

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
	// The tag names the file the row is written to, and it gives way to the value: a
	// row whose value is an ellipsis answers nothing, and the faint paint and the
	// missing checkbox already say the row is not written here.
	const tag = view.readOnly && available - TAG_WIDTH >= MIN_VALUE_WIDTH ? " · Global" : "";
	return listRow(theme, width, {
		selected,
		// A row this scope cannot write has nothing to toggle here, so a checkbox would be a
		// promise the key cannot keep. Its value column still states the setting.
		leading: view.kind === "boolean" && !view.readOnly ? checkbox(theme, view.value === "true") : " ",
		label: padTo(label, labelColumn),
		labelRole: view.readOnly ? "faint" : selected ? "accent" : "label",
		trailing: `${clip(sanitizeLine(rawValue), Math.max(1, available - visibleWidth(tag)))}${tag}`,
		trailingRole: editing ? "accent" : view.readOnly ? "faint" : "meta",
		// The value sits in its own column rather than at the far edge, so a wide
		// terminal does not put the label and its value at opposite ends of the row.
		align: "inline",
	});
}

/** The Project note: the marked rows are written to Pi's personal file, which has no project scope. */
export function projectNote(theme: Theme, width: number): string {
	return clip(`${INDENT}${paint(theme, "faint", "Change marked rows in Global scope.")}`, Math.max(1, width));
}

/** The editor's key hints: `Esc` cancels the edit, it does not close the screen. */
export function editHints(): string[] {
	return ["Esc cancel", "←/→ caret", "Enter save", "Backspace delete", "Ctrl+U clear"];
}

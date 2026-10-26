/**
 * The resource row: the one row grammar Extensions and Skills share.
 *
 * A row is a checkbox, a status glyph, the resource's name, and one verdict word.
 * A clean row carries no glyph and no word, so the column reads as one shape
 * instead of a checkmark that comes and goes, and the eye finds the rows that
 * need it.
 *
 * Pure: the theme, the width and the model row come in, one clipped line comes out.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../../../lib/format.ts";
import { clip, padTo } from "../../../../lib/tui/columns.ts";
import { checkbox, listRow } from "../../../../lib/tui/rows.ts";
import { rowBadge } from "../format.ts";
import type { PanelRow } from "../types.ts";

/** Columns the verdict keeps before the name is clipped instead. */
const MIN_VERDICT_WIDTH = 9;

/** The widest verdict the visible rows carry, so the column lines up. */
export function verdictColumn(rows: readonly PanelRow[]): number {
	return rows.reduce((columns, row) => Math.max(columns, (rowBadge(row).text ?? "").length), 0);
}

/** One resource row: its checkbox, verdict glyph, name, and verdict word. */
export function resourceRow(theme: Theme, width: number, row: PanelRow, selected: boolean, verdicts = 0): string {
	const badge = rowBadge(row);
	const name = sanitizeLine(row.label);
	// The verdict sits in its own column instead of against the name, so a column
	// of rows can be read down rather than across; a long name loses its tail
	// before the verdict loses its word.
	const room = Math.max(MIN_VERDICT_WIDTH, Math.min(verdicts, Math.max(0, width - 22)));
	const nameCell = verdicts > 0 ? padTo(clip(name, Math.max(1, width - 22)), room) : name;
	return listRow(theme, width, {
		selected,
		// A reported-only row has no enable pattern, but still reserves the box
		// column so the list stays aligned.
		leading: row.item ? checkbox(theme, row.item.enabled) : " ",
		glyph: badge.glyph ?? " ",
		glyphRole: badge.role,
		label: nameCell,
		labelRole: selected ? "accent" : row.item && !row.item.enabled ? "faint" : "label",
		trailing: badge.text,
		// The glyph carries the status colour; the word stays quiet unless it is a
		// problem, so a clean row does not shout.
		trailingRole: badge.role === "bad" || badge.role === "warn" ? badge.role : "faint",
		align: "inline",
	});
}

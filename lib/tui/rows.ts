/**
 * The row grammar: a list row, a checkbox, a status chip, a key/value row, and
 * an empty state.
 *
 * Every row is one line (an empty state is its two), built from the shared
 * token roles and the shared selection marker, and clipped with `columns.ts` so
 * it fits the width it was given. The point is that a list row looks the same
 * whether it is the extension screen, the job list, or the rewind timeline:
 *
 *   ❯ ◼ extensions  7 enabled
 *
 * Value-only: pure functions, theme passed in.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { clip, padTo, splitRow } from "./columns.ts";
import { selectionMarker } from "./cursor.ts";
import { GLYPHS } from "./glyphs.ts";
import { BODY_INDENT } from "./indent.ts";
import { paint, type TuiRole } from "./tokens.ts";

/** One selectable list row. */
export interface ListRow {
	/** Draw the `❯` marker in the accent role. A blank marker column is reserved either way. */
	selected?: boolean;
	/**
	 * Reserve the `❯ ` marker column. Default true, so a column of rows stays
	 * aligned; a non-interactive row (a transcript result) sets false to drop the
	 * columns it can never use.
	 */
	marker?: boolean;
	/**
	 * A pre-themed cell between the marker and the glyph, e.g. a `checkbox`.
	 * Reserved by the caller (pass a blank when the row has none) so a column of
	 * rows stays aligned.
	 */
	leading?: string;
	/** A leading status or type glyph, painted in `glyphRole`. */
	glyph?: string;
	glyphRole?: TuiRole;
	/** The row's text. */
	label: string;
	labelRole?: TuiRole;
	/** Right-aligned meta (a count, a time, a state). */
	trailing?: string;
	trailingRole?: TuiRole;
	/** Extra columns before the marker, for a nested row. */
	indent?: number;
}

/**
 * One list row: an optional indent, the selection marker, an optional glyph,
 * the label, and right-aligned trailing meta.
 *
 * The marker column is reserved by default, so selected and unselected rows
 * align; `marker: false` drops it for a non-interactive row. The trailing meta
 * is the anchor when the terminal is narrow (see `splitRow`), so a value at the
 * end of the row survives.
 */
export function listRow(theme: Theme, width: number, row: ListRow): string {
	const indent = " ".repeat(Math.max(0, Math.floor(row.indent ?? 0)));
	const marker = row.marker === false ? "" : selectionMarker(theme, row.selected === true);
	const leading = row.leading ? `${row.leading} ` : "";
	const glyph = row.glyph ? `${paint(theme, row.glyphRole ?? "info", row.glyph)} ` : "";
	const label = paint(theme, row.labelRole ?? "label", row.label);
	const trailing = row.trailing ? paint(theme, row.trailingRole ?? "meta", row.trailing) : "";
	return splitRow(`${indent}${marker}${leading}${glyph}${label}`, trailing, width);
}

/** A status row (a job, a watcher): the marker, a status glyph, a label, and right-aligned meta. */
export interface StatusRow {
	selected?: boolean;
	/** Reserve the marker column. Default true. */
	marker?: boolean;
	glyph: string;
	glyphRole: TuiRole;
	label: string;
	trailing: string;
	/** Role for the trailing meta. Default `faint`. */
	trailingRole?: TuiRole;
}

/** One row of a live status list, on the shared `listRow` grammar. */
export function statusRow(theme: Theme, width: number, row: StatusRow): string {
	return listRow(theme, width, {
		selected: row.selected === true,
		marker: row.marker !== false,
		glyph: row.glyph,
		glyphRole: row.glyphRole,
		label: row.label,
		trailing: row.trailing,
		trailingRole: row.trailingRole ?? "faint",
	});
}

/** The on/off checkbox glyph, in one role per state. */
export function checkbox(theme: Theme, on: boolean, roles: { on?: TuiRole; off?: TuiRole } = {}): string {
	return on ? paint(theme, roles.on ?? "ok", GLYPHS.boxOn) : paint(theme, roles.off ?? "faint", GLYPHS.boxOff);
}

/** A glyph and a short label in one color: the vocabulary of a status chip. */
export function chip(theme: Theme, glyph: string, label: string, role: TuiRole = "meta"): string {
	const head = paint(theme, role, glyph);
	return label ? `${head} ${paint(theme, role, label)}` : head;
}

/** A fixed-width label column followed by its value. */
export interface KeyValueRow {
	label: string;
	value: string;
	/** Columns the label column occupies. Default 12. */
	labelWidth?: number;
	labelRole?: TuiRole;
	valueRole?: TuiRole;
}

/**
 * One body-indented `label   value` row, the label padded to a fixed column.
 * The `BODY_INDENT` prefix matches `emptyState`, so a screen's body rows and its
 * empty state share one indent.
 */
export function keyValueRow(theme: Theme, width: number, row: KeyValueRow): string {
	const labelWidth = Math.max(1, Math.floor(row.labelWidth ?? 12));
	const label = paint(theme, row.labelRole ?? "meta", padTo(row.label, labelWidth));
	const value = paint(theme, row.valueRole ?? "label", row.value);
	return clip(`${" ".repeat(BODY_INDENT)}${label}${value}`, width);
}

/** A screen's empty state: what is missing, and the next action. */
export interface EmptyState {
	/** One line naming what is absent, e.g. `No notes yet.`. */
	label: string;
	/** An optional line naming the next action. */
	hint?: string;
}

/** The empty-state lines: a body-indented label, then its hint. */
export function emptyState(theme: Theme, width: number, state: EmptyState): string[] {
	const indent = " ".repeat(BODY_INDENT);
	const lines = [clip(`${indent}${paint(theme, "faint", state.label)}`, width)];
	if (state.hint) lines.push(clip(`${indent}${paint(theme, "faint", state.hint)}`, width));
	return lines;
}

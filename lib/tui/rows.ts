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
import { BODY_INDENT, GLYPHS } from "./glyphs.ts";
import { paint, type TuiRole } from "./tokens.ts";

/** One selectable list row. */
export interface ListRow {
	/** Draw the `❯` marker in the accent role. A blank marker column is reserved either way. */
	selected?: boolean;
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
 * The marker column is always reserved, so selected and unselected rows align.
 * The trailing meta is the anchor when the terminal is narrow (see
 * `splitRow`), so a value at the end of the row survives.
 */
export function listRow(theme: Theme, width: number, row: ListRow): string {
	const indent = " ".repeat(Math.max(0, Math.floor(row.indent ?? 0)));
	const marker = selectionMarker(theme, row.selected === true);
	const leading = row.leading ? `${row.leading} ` : "";
	const glyph = row.glyph ? `${paint(theme, row.glyphRole ?? "info", row.glyph)} ` : "";
	const label = paint(theme, row.labelRole ?? "label", row.label);
	const trailing = row.trailing ? paint(theme, row.trailingRole ?? "meta", row.trailing) : "";
	return splitRow(`${indent}${marker}${leading}${glyph}${label}`, trailing, width);
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

/** One `label   value` row, the label padded to a fixed column. */
export function keyValueRow(theme: Theme, width: number, row: KeyValueRow): string {
	const labelWidth = Math.max(1, Math.floor(row.labelWidth ?? 12));
	const label = paint(theme, row.labelRole ?? "meta", padTo(row.label, labelWidth));
	const value = paint(theme, row.valueRole ?? "label", row.value);
	return clip(`${label}${value}`, width);
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
	const lines = [clip(`${indent}${paint(theme, "meta", state.label)}`, width)];
	if (state.hint) lines.push(clip(`${indent}${paint(theme, "faint", state.hint)}`, width));
	return lines;
}

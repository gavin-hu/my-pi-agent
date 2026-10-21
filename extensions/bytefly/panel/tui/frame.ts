/**
 * The chrome around the panel's body: the layout constants, the section bar with
 * its counts, a group heading, the hint row that a transient notice replaces, and
 * the frame the two sections share.
 *
 * Every section draws its body through these, so the two views cannot drift on
 * spacing, roles, or the width arithmetic.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../../../lib/format.ts";
import {
	detailBlockRows,
	dockListFrame,
	screenHint,
	type ScreenHint,
	type ViewportRowsSource,
} from "../../../../lib/tui/chrome.ts";
import { clip, fitCells, splitRow } from "../../../../lib/tui/columns.ts";
import { fitRows, formatRange, type ListCursor } from "../../../../lib/tui/cursor.ts";
import { BODY_INDENT } from "../../../../lib/tui/indent.ts";
import { paint } from "../../../../lib/tui/tokens.ts";
import { sectionSegments, type SummarySegment } from "../format.ts";
import type { PanelSection } from "../types.ts";
import { selectableRange, type PanelEntry } from "./entries.ts";

/** Body rows when the terminal height is unknown. */
export const SCREEN_DEFAULT_ROWS = 16;
/** Fixed rows around the body: header, summary, blank, blank, hint, blank. */
export const FRAME_ROWS = 6;
/** Detail rows reserved for the focused row: its head, one description line, and its origin. */
export const DETAIL_ROWS = 3;
/** Body rows that must survive before the detail pane collapses to its title. */
export const MIN_BODY_ROWS = 3;
/** Detail rows when the terminal height is unknown and the focused row is expanded. */
export const EXPANDED_DETAIL_FALLBACK = 8;
/** Fixed body offset in the frame: header, summary, blank line. */
export const BODY_START = 3;

/** The body indent, shared by the note and the detail pane. */
export const INDENT = " ".repeat(BODY_INDENT);

/** The themed section bar: both section names, the active one accented. */
export function sectionBar(theme: Theme, width: number, active: PanelSection, counts: string): string {
	const separator = paint(theme, "faint", " · ");
	const left = `  ${sectionSegments(active)
		.map((segment) => paint(theme, segment.color, segment.text))
		.join(separator)}`;
	return clip(splitRow(left, counts, width), width);
}

/** One section's counts as whole segments, so a narrow screen drops a count. */
export function countsLine(theme: Theme, width: number, segments: readonly SummarySegment[]): string {
	const separator = paint(theme, "faint", " · ");
	const styled = segments.map((segment) => paint(theme, segment.color, segment.text));
	return fitCells(styled, Math.max(1, width - 2), separator);
}

/** One group heading: its label and how many rows sit under it. */
export function groupLine(theme: Theme, width: number, entry: { label: string; count: number }): string {
	const label = paint(theme, "meta", sanitizeLine(entry.label));
	const count = paint(theme, "faint", `(${entry.count})`);
	return clip(`  ${label} ${count}`, width);
}

/** The key-hint row, or a section's notice that replaces it. */
export function hintLine(theme: Theme, width: number, hints: ScreenHint[]): string {
	return screenHint(theme, width, hints);
}

/** The transient notice row, clipped and painted like the hint it replaces. */
export function noticeLine(theme: Theme, width: number, notice: string): string {
	return clip(`${INDENT}${paint(theme, "meta", sanitizeLine(notice))}`, width);
}

/** The saved-then-reload marker, shared by both detail panes. */
export function savedLine(theme: Theme, width: number, dirty: boolean): string[] {
	if (!dirty) return [];
	return [clip(`${INDENT}${paint(theme, "warn", "Saved · reload to apply")}`, width)];
}

/** Terminal rows, or `undefined` when the height is unknown. */
export function totalRows(source: ViewportRowsSource | undefined): number | undefined {
	const rows = typeof source === "function" ? source() : source;
	return rows !== undefined && Number.isFinite(rows) && rows > 0 ? rows : undefined;
}

/**
 * Detail rows the focused row gets: the fixed pane, or the free height when
 * expanded. Zero when there is no free row for a pane at all, so a short
 * terminal keeps its body; the caller then drops optional rows if needed.
 */
export function detailRows(expanded: boolean, viewportRows: ViewportRowsSource | undefined): number {
	const total = totalRows(viewportRows);
	if (total === undefined) return expanded ? EXPANDED_DETAIL_FALLBACK : DETAIL_ROWS;
	// One row pays for the blank line the frame puts above the pane.
	const available = total - FRAME_ROWS - MIN_BODY_ROWS - 1;
	if (available < 1) return 0;
	return expanded ? available : Math.min(DETAIL_ROWS, available);
}

/**
 * Drop optional rows until the frame fits the viewport: the range row first,
 * then the project note, then the blank above the detail pane, then the pane.
 * The header, summary, one body row, and the hint always survive; a terminal
 * shorter than those is left to the host.
 */
export function fitOptionalLines(options: {
	viewportRows: ViewportRowsSource | undefined;
	body: string[];
	note: string | undefined;
	range: string | undefined;
	detail: string[];
}): { body: string[]; range: string | undefined; detail: string[]; noteShown: boolean; detailBlank: boolean } {
	const total = totalRows(options.viewportRows);
	let { body, range, detail } = options;
	let noteShown = options.note !== undefined && body[0] === options.note;
	if (total === undefined) return { body, range, detail, noteShown, detailBlank: true };
	const fits = (blank: boolean): boolean =>
		FRAME_ROWS + body.length + (range === undefined ? 0 : 1) + detailBlockRows(detail, blank) <= total;
	if (!fits(true)) range = undefined;
	if (!fits(true) && noteShown) {
		body = body.slice(1);
		noteShown = false;
	}
	// The separator goes before the pane does: the focused row's findings are
	// worth more than the blank above them.
	const detailBlank = fits(true) || !fits(false);
	if (!fits(false)) detail = [];
	return { body, range, detail, noteShown, detailBlank };
}

/** What {@link panelFrame} draws: the window, the body, and the chrome around it. */
export interface PanelFrameInput {
	theme: Theme;
	viewportRows: ViewportRowsSource | undefined;
	cursor: ListCursor;
	width: number;
	header: string;
	summary: string;
	entries: readonly PanelEntry[];
	note?: string;
	detail: string[];
	hint: string;
	draw: (entry: PanelEntry, index: number) => string | undefined;
}

/**
 * The frame both sections share: the cursor window, the visible body rows, the
 * range row, the optional rows that give way on a short terminal, and the
 * chrome around them. Each section supplies its summary, its detail pane, its
 * hint row, and how one entry is drawn.
 */
export function panelFrame(input: PanelFrameInput): { lines: string[]; noteShown: boolean } {
	const { theme, viewportRows, cursor, width, entries, note, detail, hint, draw } = input;
	cursor.visible = fitRows(
		viewportRows,
		entries.length,
		FRAME_ROWS + detailBlockRows(detail) + (note ? 1 : 0),
		SCREEN_DEFAULT_ROWS,
	);
	cursor.sync(entries.length);
	const { start, end } = cursor.window(entries.length);

	const body: string[] = [];
	if (note) body.push(note);
	for (let index = start; index < end; index += 1) {
		const line = draw(entries[index], index);
		if (line !== undefined) body.push(line);
	}

	const range = cursor.clipped(entries.length)
		? formatRange(theme, width, selectableRange(entries, { start, end }))
		: undefined;
	const fitted = fitOptionalLines({ viewportRows, body, note, range, detail });
	return {
		lines: dockListFrame({
			header: input.header,
			summary: input.summary,
			body: fitted.body,
			range: fitted.range,
			detail: fitted.detail.length > 0 ? fitted.detail : undefined,
			detailBlank: fitted.detailBlank,
			hint,
		}),
		noteShown: fitted.noteShown,
	};
}

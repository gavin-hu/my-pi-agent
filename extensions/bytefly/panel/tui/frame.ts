/**
 * The chrome around the panel's body: the header rule with the screen's
 * attention, the section tabs with their counts and the write scope, a group
 * heading, the hint row that a transient notice replaces, and the frame all three
 * sections share.
 *
 * Every section draws its body through {@link panelFrame}, so the three cannot
 * drift on spacing, roles, width arithmetic, or height: the body is padded to one
 * target measured across all three sections, which is what keeps the dock from
 * resizing when the tabs change.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../../../lib/format.ts";
import {
	detailBlockRows,
	dockListFrame,
	screenHint,
	type ScreenHint,
	type ViewportRowsSource,
} from "../../../../lib/tui/chrome.ts";
import { clip, fitCells, splitRow } from "../../../../lib/tui/columns.ts";
import { formatRange, type ListCursor } from "../../../../lib/tui/cursor.ts";
import { SEPARATORS } from "../../../../lib/tui/glyphs.ts";
import { BODY_INDENT } from "../../../../lib/tui/indent.ts";
import { emptyState } from "../../../../lib/tui/rows.ts";
import { titleRule } from "../../../../lib/tui/rules.ts";
import { paint } from "../../../../lib/tui/tokens.ts";
import { sectionLabel, type SummarySegment } from "../format.ts";
import type { PanelSection } from "../types.ts";
import { selectableRange, type PanelEntry } from "./entries.ts";
import { composeRows } from "./panes.ts";

/** Body rows when the terminal height is unknown. */
export const SCREEN_DEFAULT_ROWS = 16;
/** Fixed rows around the body: header, tabs, blank, blank, hint, closing rule. */
export const FRAME_ROWS = 6;
/** Detail rows reserved for the focused row in the single-column layout. */
export const DETAIL_ROWS = 3;
/** Body rows that must survive before the bottom pane collapses to nothing. */
export const MIN_BODY_ROWS = 3;
/** Detail rows when the terminal height is unknown and the focused row is expanded. */
export const EXPANDED_DETAIL_FALLBACK = 8;
/** Fixed body offset in the frame: header, tabs, blank line. */
export const BODY_START = 3;

/** The body indent, shared by the note and any focused-row block. */
export const INDENT = " ".repeat(BODY_INDENT);

/**
 * The header rule: the screen's name first, the attention it found at the right
 * edge. The right side is dropped whole on a narrow terminal rather than clipped
 * into half a word; the tabs below carry the same facts.
 */
export function headerLine(theme: Theme, width: number, title: string, right: readonly SummarySegment[]): string {
	const w = Math.max(1, width);
	const separator = paint(theme, "faint", SEPARATORS.item);
	const text = right.map((segment) => paint(theme, segment.color, segment.text)).join(separator);
	const rightWidth = visibleWidth(text);
	if (text === "" || rightWidth + title.length + 4 > w) return titleRule(theme, w, title);
	return `${titleRule(theme, w - rightWidth - 1, title)} ${text}`;
}

/**
 * The tab row: every section with how many rows it holds, then any filter chips,
 * and the scope a change is written to at the right edge. The active tab takes the
 * accent; the counts stay faint so the names read first.
 */
export function tabsLine(
	theme: Theme,
	width: number,
	active: PanelSection,
	counts: Record<PanelSection, number>,
	options: { chips?: readonly SummarySegment[]; scope?: string } = {},
): string {
	const separator = paint(theme, "faint", SEPARATORS.item);
	const tabs = (["extensions", "skills", "settings"] as const).map(
		(section) =>
			paint(theme, section === active ? "accent" : "faint", sectionLabel(section)) +
			paint(theme, "faint", ` ${counts[section]}`),
	);
	const chips = options.chips ?? [];
	const left = [
		`  ${tabs.join(separator)}`,
		...(chips.length > 0 ? [`  ${chips.map((chip) => paint(theme, chip.color, chip.text)).join(separator)}`] : []),
	].join("");
	const right = options.scope === undefined ? "" : paint(theme, "meta", `writes ${options.scope}`);
	return clip(splitRow(left, right, width), width);
}

/** One section's counts as whole segments, so a narrow screen drops a count. */
export function countsLine(theme: Theme, width: number, segments: readonly SummarySegment[]): string {
	const separator = paint(theme, "faint", SEPARATORS.item);
	const styled = segments.map((segment) => paint(theme, segment.color, segment.text));
	return fitCells(styled, Math.max(1, width - 2), separator);
}

/** One group heading: its label, and how many rows sit under it. */
export function groupLine(theme: Theme, width: number, entry: { label: string; count: number }): string {
	const label = paint(theme, "meta", sanitizeLine(entry.label));
	const count = entry.count > 0 ? paint(theme, "faint", ` (${entry.count})`) : "";
	return clip(`  ${label}${count}`, width);
}

/** The key-hint row, or a section's notice that replaces it. */
export function hintLine(theme: Theme, width: number, hints: ScreenHint[]): string {
	return screenHint(theme, width, hints);
}

/** The transient notice row, clipped and painted like the hint it replaces. */
export function noticeLine(theme: Theme, width: number, notice: string): string {
	return clip(`${INDENT}${paint(theme, "meta", sanitizeLine(notice))}`, width);
}

/** The saved-then-reload marker, shared by every focused-row block. */
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
 * The rows the bottom pane gets in the single-column layout: the fixed pane, or
 * the free height when expanded. Zero when there is no free row for a pane at all,
 * so a short terminal keeps its body.
 */
export function detailRows(expanded: boolean, viewportRows: ViewportRowsSource | undefined): number {
	const total = totalRows(viewportRows);
	if (total === undefined) return expanded ? EXPANDED_DETAIL_FALLBACK : DETAIL_ROWS;
	const available = total - FRAME_ROWS - MIN_BODY_ROWS - 1;
	if (available < 1) return 0;
	return expanded ? available : Math.min(DETAIL_ROWS, available);
}

/** What {@link panelFrame} draws: the window, the body, and the chrome around it. */
export interface PanelFrameInput {
	theme: Theme;
	viewportRows: ViewportRowsSource | undefined;
	cursor: ListCursor;
	width: number;
	header: string;
	tabs: string;
	entries: readonly PanelEntry[];
	note?: string;
	/** The focused row's block, drawn under the list below the pane breakpoint. */
	detail: string[];
	hint: string;
	/** The line a section shows in place of its body when it has no entries. */
	emptyLabel?: string;
	/**
	 * The tallest section's row count. The body is padded to it (bounded by the
	 * viewport), so every section draws the same height.
	 */
	tallest: number;
	/** The side pane's rows, in the wide layout only. */
	side?: (rows: number) => string[];
	draw: (entry: PanelEntry, index: number) => string | undefined;
}

/** The frame both sections share, and the state the caller has to remember. */
export interface PanelFrameResult {
	lines: string[];
	/** Whether the project note survived the row budget, for the click mapping. */
	noteShown: boolean;
	/** Body rows drawn, so a caller can map a click to a row. */
	bodyRows: number;
}

/**
 * The frame every section draws: the cursor window, the padded body, the range
 * row when the list scrolls, the optional rows that give way on a short terminal,
 * and the chrome around them.
 *
 * The height comes from one place. With a side pane the body is the whole free
 * height, capped by the tallest section; without one the bottom pane is paid for
 * first and the body gets what is left. Either way `target` is the same for all
 * three sections at a given terminal size.
 */
export function panelFrame(input: PanelFrameInput): PanelFrameResult {
	const { theme, viewportRows, cursor, width, entries, note, hint } = input;
	const total = totalRows(viewportRows);
	const wide = input.side !== undefined;

	// Costs that a short terminal can shed, in the order they go: the bottom pane
	// first (its facts move nowhere, but the list matters more), then the note.
	let detail = wide ? [] : input.detail;
	let noteShown = note !== undefined;
	const budgetFor = (): number => {
		if (total === undefined) return Math.max(MIN_BODY_ROWS, input.tallest);
		return total - FRAME_ROWS - detailBlockRows(wide ? [] : detail) - (noteShown ? 1 : 0);
	};
	if (budgetFor() < MIN_BODY_ROWS && !wide) detail = [];
	if (budgetFor() < MIN_BODY_ROWS && noteShown) noteShown = false;

	const target = Math.max(1, Math.min(budgetFor(), Math.max(1, input.tallest)));
	const capacity = Math.max(1, target - (noteShown && note !== undefined ? 1 : 0));
	const scrolling = entries.length > capacity;
	cursor.visible = Math.max(1, capacity - (scrolling ? 1 : 0));
	cursor.sync(entries.length);
	const { start, end } = cursor.window(entries.length);

	const body: string[] = [];
	if (note !== undefined && noteShown) body.push(note);
	if (entries.length === 0 && input.emptyLabel !== undefined) {
		body.push(...emptyState(theme, width, { label: input.emptyLabel }));
	}
	for (let index = start; index < end; index += 1) {
		const line = input.draw(entries[index], index);
		if (line !== undefined) body.push(line);
	}
	if (scrolling) {
		body.push(formatRange(theme, width, selectableRange(entries, { start, end })));
	}
	while (body.length < target) body.push("");

	const side = input.side === undefined ? undefined : input.side(target);
	const lines = dockListFrame({
		theme,
		width,
		header: input.header,
		summary: input.tabs,
		body: side === undefined ? body : composeRows(theme, width, body, side),
		detail: detail.length > 0 ? detail : undefined,
		hint,
	});
	return { lines, noteShown, bodyRows: target };
}

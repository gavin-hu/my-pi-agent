/**
 * The chrome around the panel's body: the layout constants, the section bar with
 * its counts, a group heading, and the hint row that a transient notice replaces.
 *
 * Every section draws its body through these, so the two views cannot drift on
 * spacing, roles, or the width arithmetic.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../../../lib/format.ts";
import { screenHint, type ScreenHint } from "../../../../lib/tui/chrome.ts";
import { clip, fitCells, splitRow } from "../../../../lib/tui/columns.ts";
import { BODY_INDENT } from "../../../../lib/tui/indent.ts";
import { paint } from "../../../../lib/tui/tokens.ts";
import { sectionSegments, type SummarySegment } from "../format.ts";
import type { PanelSection } from "../types.ts";

/** Body rows when the terminal height is unknown. */
export const SCREEN_DEFAULT_ROWS = 16;
/** Fixed rows around the body: header, summary, blank, blank, hint, blank. */
export const FRAME_ROWS = 6;
/** Detail rows reserved for the focused row. */
export const DETAIL_ROWS = 4;
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

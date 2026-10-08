/**
 * Small TUI helpers shared by extension screens (checkpoint, plan-mode).
 *
 * Screens are full-width, terminal-height-aware components. These helpers build
 * the top rule and clamp a screen's body to the terminal, so each screen keeps
 * its own layout but not its own copy of the arithmetic.
 *
 * No runtime dependencies beyond `@earendil-works/pi-tui`: the theme is passed
 * in, and the viewport options are explicit.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

/**
 * Top border with `label` centered-left, exactly `width` columns wide. When the
 * terminal is too narrow for the title and a border on each side, it degrades to
 * a plain rule rather than truncating the title into an ellipsis.
 */
export function screenHeader(theme: Theme, width: number, label: string): string {
	const text = ` ${label} `;
	const prefix = "───";
	if (width < visibleWidth(prefix) + visibleWidth(text) + 1) {
		return theme.fg("borderMuted", "─".repeat(Math.max(0, width)));
	}
	const remaining = width - visibleWidth(prefix) - visibleWidth(text);
	return theme.fg("borderMuted", prefix) + theme.fg("accent", text) + theme.fg("borderMuted", "─".repeat(remaining));
}

/** A row count, or a live getter so a screen re-sizes with the terminal. */
export type ViewportRowsSource = number | (() => number | undefined);

export interface ViewportRowsOptions {
	/** Header, summary, detail, footer, and blank rows the screen spends around the body. */
	chrome: number;
	/** Body rows when the terminal height is unknown. */
	fallback: number;
}

/**
 * How many body rows fit in the terminal. When the height is known the screen
 * fills it (`rows - chrome`), shrinking on short terminals rather than
 * overflowing; `fallback` is used only when the height is unknown. A getter is
 * resolved per call so a resized terminal is picked up on the next render.
 */
export function viewportRows(source: ViewportRowsSource | undefined, options: ViewportRowsOptions): number {
	const rows = typeof source === "function" ? source() : source;
	if (rows === undefined || !Number.isFinite(rows) || rows <= 0) return Math.max(1, options.fallback);
	return Math.max(1, rows - options.chrome);
}

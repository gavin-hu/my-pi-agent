/**
 * Small TUI helpers shared by extension screens (rewind, jobs, plan-mode,
 * todo).
 *
 * `FULL_SCREEN_OVERLAY` is for the one surface that must own the whole terminal:
 * the plan read/review screen. Every list screen (`/todos`, `/jobs`,
 * `/rewind`) stays in the dock's editor slot so they match each other and
 * leave the transcript visible.
 *
 * Screens are full-width, terminal-height-aware components. These helpers build
 * the top rule, clamp a screen's body to the terminal, and render the key-hint
 * footer, so each screen keeps its own layout but not its own copy of the
 * arithmetic or hint vocabulary.
 *
 * No runtime dependencies beyond `@earendil-works/pi-tui`: the theme is passed
 * in, and the viewport options are explicit.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type OverlayOptions } from "@earendil-works/pi-tui";
import { SEPARATORS } from "./ui.ts";

/**
 * `ctx.ui.custom` options that give a screen the whole terminal.
 *
 * Without `overlay`, Pi mounts the component in the editor slot of its dock,
 * where it shares the terminal with the transcript, status line, widgets, and
 * footer. A screen sized to `terminal.rows` then overflows the slot and the
 * layout clips its bottom — losing the screen's own footer. Mounting as a
 * full-screen overlay keeps the row budget equal to the terminal's, however
 * much chrome the dock carries; keep the chrome budget small on dock-mounted
 * list screens so their footer survives the slot.
 */
export const FULL_SCREEN_OVERLAY: { overlay: true; overlayOptions: OverlayOptions } = {
	overlay: true,
	overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 },
};

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

interface ViewportRowsOptions {
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

/**
 * A dim, two-space-indented key-hint footer, joined with ` · `. Hints are added
 * while they fit, so a narrow terminal drops whole keys instead of truncating
 * one in half. The first hint is always kept; the result is clipped to `width`.
 */
export function screenHint(theme: Theme, width: number, hints: string[]): string {
	const target = Math.max(1, width);
	const kept: string[] = [];
	for (const hint of hints) {
		const candidate = [...kept, hint].join(SEPARATORS.item);
		if (kept.length > 0 && visibleWidth(`  ${candidate}`) > target) break;
		kept.push(hint);
	}
	return truncateToWidth(`  ${theme.fg("dim", kept.join(SEPARATORS.item))}`, target);
}

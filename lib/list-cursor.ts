/**
 * Scrollable-list behavior shared by the interactive screens that re-implement
 * it (`/plans`, `/rewind`, `/todos`, `/jobs`).
 *
 * Each screen keeps its own layout, rows, and selection model — plans and
 * rewind use an index, jobs use a stable id, todos have no cursor at all — but
 * they all need the same arithmetic: how many rows fit, how to keep the focus
 * in view, which keys navigate, and how to render the "showing X–Y of N" row.
 * That shared part lives here so a fix or a rebinding happens once.
 *
 * No runtime dependencies beyond `lib/tui.ts` and `@earendil-works/pi-tui`; the
 * theme is passed in and there is no cross-extension state.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { viewportRows, type ViewportRowsSource } from "./tui.ts";

/**
 * Rows that fit for a list of `itemCount`, reserving one extra line when the
 * list is longer than the viewport (so the range row does not push out a row).
 * `chrome` is the fixed number of rows the screen spends around the body;
 * `fallback` is used only when the terminal height is unknown.
 */
export function fitRows(
	source: ViewportRowsSource | undefined,
	itemCount: number,
	chrome: number,
	fallback: number,
): number {
	let visible = viewportRows(source, { chrome, fallback });
	if (itemCount > visible) visible = viewportRows(source, { chrome: chrome + 1, fallback });
	return visible;
}

/** Scroll offset that keeps `selected` inside `[scrollTop, scrollTop + visible)`. */
export function keepVisible(scrollTop: number, selected: number, visible: number): number {
	if (selected < scrollTop) return selected;
	if (selected >= scrollTop + visible) return selected - visible + 1;
	return scrollTop;
}

/** Clamp a scroll offset into `[0, max(0, count - visible)]`. */
export function clampScroll(next: number, count: number, visible: number): number {
	return Math.min(Math.max(0, next), Math.max(0, count - visible));
}

/** Direction a navigation key asks for; `undefined` means "not a navigation key". */
export type NavIntent = "up" | "down" | "pageUp" | "pageDown" | "home" | "end";

/**
 * Map a raw key chunk to a navigation intent, or `undefined` for any other key.
 *
 * Screens handle their own Escape/Enter/action keys first and then look here,
 * so a screen-specific letter (`d`, `u`, `l`, …) is never swallowed.
 */
export function navIntent(data: string): NavIntent | undefined {
	if (matchesKey(data, Key.up) || data === "k") return "up";
	if (matchesKey(data, Key.down) || data === "j") return "down";
	if (matchesKey(data, Key.pageUp)) return "pageUp";
	if (matchesKey(data, Key.pageDown)) return "pageDown";
	if (matchesKey(data, Key.home)) return "home";
	if (matchesKey(data, Key.end)) return "end";
	return undefined;
}

/** Wheel delta from a mouse event, or `undefined` when it is not a wheel scroll. */
export function wheelDelta(event: TuiMouseEvent): number | undefined {
	return event.type === "wheel" && event.wheelDelta ? event.wheelDelta : undefined;
}

/** The `❯ ` selection marker (accent) or a same-width blank. */
export function selectionMarker(theme: Theme, selected: boolean): string {
	return selected ? theme.fg("accent", "❯ ") : "  ";
}

/**
 * One dim, two-space-indented range row: `showing A–B of N` by default, or
 * `line A–B of N` for a log pane. Clipped to `width`.
 */
export function formatRange(
	theme: Theme,
	width: number,
	range: { start: number; end: number; total: number; label?: string },
): string {
	const label = range.label ?? "showing";
	const text = `  ${label} ${range.start + 1}–${range.end} of ${range.total}`;
	return truncateToWidth(theme.fg("dim", text), Math.max(1, width));
}

/**
 * Cursor and window state for a selectable list. The screen owns rendering and
 * assigns `visible` from {@link fitRows} on each render; the cursor only tracks
 * `selected`/`scrollTop` and asks for a repaint when the focus moves.
 */
export class ListCursor {
	/** Focused row index. */
	selected = 0;
	/** First visible row. */
	scrollTop = 0;
	/** Rows shown at once; the screen sets this before use. */
	visible = 1;

	constructor(private readonly requestRender: () => void) {}

	/** Clamp to `count` and keep the focus visible; never repaints. */
	sync(count: number): void {
		if (count <= 0) {
			this.selected = 0;
			this.scrollTop = 0;
			return;
		}
		this.selected = Math.min(Math.max(0, this.selected), count - 1);
		this.scrollTop = Math.max(0, keepVisible(this.scrollTop, this.selected, this.visible));
		this.scrollTop = Math.min(this.scrollTop, Math.max(0, count - this.visible));
	}

	/** Focus `next` (clamped); repaints only when it actually moves. */
	set(next: number, count: number): void {
		if (count <= 0) return;
		const clamped = Math.min(Math.max(0, next), count - 1);
		if (clamped === this.selected) return;
		this.selected = clamped;
		this.scrollTop = Math.max(0, keepVisible(this.scrollTop, this.selected, this.visible));
		this.requestRender();
	}

	/** Move the focus by `delta` rows. */
	by(delta: number, count: number): void {
		this.set(this.selected + delta, count);
	}

	/** Move the focus by one page in `direction` (`-1` back, `1` forward). */
	page(direction: -1 | 1, count: number): void {
		this.set(this.selected + direction * Math.max(1, this.visible), count);
	}

	/** The half-open visible range `[start, end)`. */
	window(count: number): { start: number; end: number } {
		const start = this.scrollTop;
		return { start, end: Math.min(count, start + this.visible) };
	}

	/** Whether the window omits rows, so a range row is warranted. */
	clipped(count: number): boolean {
		return this.scrollTop > 0 || this.window(count).end < count;
	}
}

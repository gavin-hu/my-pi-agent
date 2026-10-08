/**
 * Terminal rendering for the rewind timeline.
 *
 * `RewindListComponent` is the selectable screen `/rewind` opens in the TUI.
 * Rows are id-free and width-safe: a leading `◆` marks a prompt that has a code
 * snapshot, and the focused row's detail line says whether code will be
 * restored. The component resolves the chosen point through `onClose`, so the
 * scope dialog runs only after the screen is gone and input focus is free.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { fitRows, formatRange, ListCursor, navIntent, selectionMarker, wheelDelta } from "../../../lib/list-cursor.ts";
import { screenHeader, type ViewportRowsSource } from "../../../lib/tui.ts";
import { formatRewindDetail, formatRewindRow } from "./format.ts";
import type { RewindPoint } from "./timeline.ts";

export interface RewindListOptions {
	points: RewindPoint[];
	theme: Theme;
	/** Called once when the screen closes, with the chosen point or undefined. */
	onClose: (point?: RewindPoint) => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
}

/** Rows the screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ITEMS = 12;
/** Header, summary, blanks, and footer rows around the list (excluding the optional range/detail rows). */
const SCREEN_CHROME_ROWS = 8;

/** Selectable, scrollable timeline of prompts opened by `/rewind`. */
export class RewindListComponent implements Component {
	private readonly cursor: ListCursor;

	constructor(private readonly options: RewindListOptions) {
		this.cursor = new ListCursor(options.requestRender);
	}

	private get points(): RewindPoint[] {
		return this.options.points;
	}

	private get theme(): Theme {
		return this.options.theme;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.options.onClose(undefined);
			return;
		}
		const count = this.points.length;
		switch (navIntent(data)) {
			case "up":
				this.cursor.by(-1, count);
				return;
			case "down":
				this.cursor.by(1, count);
				return;
			case "pageUp":
				this.cursor.page(-1, count);
				return;
			case "pageDown":
				this.cursor.page(1, count);
				return;
			case "home":
				this.cursor.set(0, count);
				return;
			case "end":
				this.cursor.set(count - 1, count);
				return;
		}
		if (matchesKey(data, Key.enter) || data === "r") {
			const point = this.points[this.cursor.selected];
			if (point) this.options.onClose(point);
		}
	}

	/** Wheel scrolling in fullscreen moves the cursor; regular mode leaves the wheel to the terminal. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const delta = wheelDelta(event);
		if (delta === undefined) return undefined;
		this.cursor.by(delta, this.points.length);
		return { handled: true };
	}

	dispose(): void {}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const lines: string[] = [screenHeader(this.theme, w, "Rewind"), ""];

		if (this.points.length === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No prompts on this branch yet.")}`, w));
		} else {
			const count = `${this.points.length} prompt${this.points.length === 1 ? "" : "s"}`;
			lines.push(truncateToWidth(`  ${this.theme.fg("muted", `${count} · newest first`)}`, w));
			lines.push("");
			const cursor = this.cursor;
			const focused = this.points[cursor.selected];
			const detail = focused ? formatRewindDetail(Boolean(focused.snapshot), focused.snapshot?.id) : "";
			cursor.visible = fitRows(
				this.options.viewportRows,
				this.points.length,
				SCREEN_CHROME_ROWS + (detail ? 1 : 0),
				SCREEN_DEFAULT_ITEMS,
			);

			const { start, end } = cursor.window(this.points.length);
			for (let i = start; i < end; i++) {
				const selected = i === cursor.selected;
				const row = formatRewindRow(
					this.points[i].summary,
					Boolean(this.points[i].snapshot),
					this.points[i].timestamp,
					Date.now(),
					Math.max(1, w - 2),
				);
				const body = selected ? this.theme.fg("accent", row) : this.theme.fg("dim", row);
				lines.push(truncateToWidth(selectionMarker(this.theme, selected) + body, w));
			}
			if (cursor.clipped(this.points.length)) {
				lines.push(formatRange(this.theme, w, { start, end, total: this.points.length }));
			}
			lines.push("");
			if (detail) lines.push(truncateToWidth(`  ${this.theme.fg("muted", detail)}`, w));
		}

		lines.push(truncateToWidth(`  ${this.theme.fg("dim", "Enter rewind · Esc close")}`, w));
		lines.push("");
		return lines;
	}
}

/**
 * Terminal rendering for the rewind timeline.
 *
 * `RewindListComponent` is the selectable screen `/rewind` opens in the TUI.
 * Rows are id-free and width-safe: a leading `↺` marks a prompt that has a code
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
import { screenHeader, viewportRows, type ViewportRowsSource } from "../_shared/tui.ts";
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
	private selected = 0;
	private scrollTop = 0;
	private visible = SCREEN_DEFAULT_ITEMS;

	constructor(private readonly options: RewindListOptions) {}

	private get points(): RewindPoint[] {
		return this.options.points;
	}

	private get theme(): Theme {
		return this.options.theme;
	}

	private setSelected(next: number): void {
		if (this.points.length === 0) return;
		const clamped = Math.min(Math.max(0, next), this.points.length - 1);
		if (clamped === this.selected) return;
		this.selected = clamped;
		if (this.selected < this.scrollTop) this.scrollTop = this.selected;
		else if (this.selected >= this.scrollTop + this.visible) this.scrollTop = this.selected - this.visible + 1;
		this.options.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.options.onClose(undefined);
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") this.setSelected(this.selected - 1);
		else if (matchesKey(data, Key.down) || data === "j") this.setSelected(this.selected + 1);
		else if (matchesKey(data, Key.pageUp)) this.setSelected(this.selected - this.visible);
		else if (matchesKey(data, Key.pageDown)) this.setSelected(this.selected + this.visible);
		else if (matchesKey(data, Key.home)) this.setSelected(0);
		else if (matchesKey(data, Key.end)) this.setSelected(this.points.length - 1);
		else if (matchesKey(data, Key.enter) || data === "r") {
			const point = this.points[this.selected];
			if (point) this.options.onClose(point);
		}
	}

	/** Wheel scrolling in fullscreen moves the cursor; regular mode leaves the wheel to the terminal. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel" || !event.wheelDelta) return undefined;
		this.setSelected(this.selected + event.wheelDelta);
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
			const focused = this.points[this.selected];
			const detail = focused ? formatRewindDetail(Boolean(focused.snapshot), focused.snapshot?.id) : "";
			let visible = viewportRows(this.options.viewportRows, {
				chrome: SCREEN_CHROME_ROWS + (detail ? 1 : 0),
				fallback: SCREEN_DEFAULT_ITEMS,
			});
			if (this.points.length > visible) {
				visible = viewportRows(this.options.viewportRows, {
					chrome: SCREEN_CHROME_ROWS + (detail ? 1 : 0) + 1,
					fallback: SCREEN_DEFAULT_ITEMS,
				});
			}
			this.visible = visible;
			const end = Math.min(this.points.length, this.scrollTop + visible);
			for (let i = this.scrollTop; i < end; i++) {
				const selected = i === this.selected;
				const row = formatRewindRow(
					this.points[i].summary,
					Boolean(this.points[i].snapshot),
					this.points[i].timestamp,
					Date.now(),
					Math.max(1, w - 2),
				);
				const marker = selected ? this.theme.fg("accent", "❯ ") : "  ";
				const body = selected ? this.theme.fg("accent", row) : this.theme.fg("dim", row);
				lines.push(truncateToWidth(marker + body, w));
			}
			if (this.scrollTop > 0 || end < this.points.length) {
				lines.push(
					truncateToWidth(this.theme.fg("dim", `  showing ${this.scrollTop + 1}–${end} of ${this.points.length}`), w),
				);
			}
			lines.push("");
			if (detail) lines.push(truncateToWidth(`  ${this.theme.fg("muted", detail)}`, w));
		}

		lines.push(truncateToWidth(`  ${this.theme.fg("dim", "Enter rewind · Esc close")}`, w));
		lines.push("");
		return lines;
	}
}

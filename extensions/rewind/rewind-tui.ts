/**
 * Terminal rendering for the rewind timeline.
 *
 * `RewindListComponent` is the selectable screen `/rewind` opens in the TUI.
 * Rows are id-free and width-safe: a leading `⬥` marks a prompt that has a code
 * snapshot, and the focused row's detail line says whether code will be
 * restored. The component resolves the chosen point through `onClose`, so the
 * scope dialog runs only after the screen is gone and input focus is free.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { fitRows, formatRange, isCloseKey, ListCursor, navigateList, scrollList } from "../../lib/tui/cursor.ts";
import { detailBlockRows, dockListFrame, screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { emptyState, listRow } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { formatRewindDetail, formatRewindParts } from "./format.ts";
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
const SCREEN_CHROME_ROWS = 6;

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
		if (isCloseKey(data)) {
			this.options.onClose(undefined);
			return;
		}
		const count = this.points.length;
		if (navigateList(data, this.cursor, count)) return;
		if (matchesKey(data, Key.enter) || data === "r") {
			const point = this.points[this.cursor.selected];
			if (point) this.options.onClose(point);
		}
	}

	/** Wheel scrolling in fullscreen moves the cursor; regular mode leaves the wheel to the terminal. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return scrollList(event, this.cursor, this.points.length);
	}

	dispose(): void {}

	invalidate(): void {}

	// The shared dock frame, like every other list screen.
	render(width: number): string[] {
		const w = Math.max(1, width);
		const header = titleRule(this.theme, w, "Rewind");

		if (this.points.length === 0) {
			return dockListFrame({
				theme: this.theme,
				width: w,
				header,
				body: emptyState(this.theme, w, { label: "No prompts on this branch yet." }),
				hint: this.hint(w),
			});
		}

		const count = `${this.points.length} prompt${this.points.length === 1 ? "" : "s"}`;
		const cursor = this.cursor;
		const focused = this.points[cursor.selected];
		const detail = focused ? formatRewindDetail(Boolean(focused.snapshot), focused.snapshot?.id) : "";
		const detailLines = detail ? [clip(`  ${paint(this.theme, "meta", detail)}`, w)] : undefined;
		cursor.visible = fitRows(
			this.options.viewportRows,
			this.points.length,
			SCREEN_CHROME_ROWS + detailBlockRows(detailLines),
			SCREEN_DEFAULT_ITEMS,
		);

		const { start, end } = cursor.window(this.points.length);
		const body: string[] = [];
		for (let i = start; i < end; i++) {
			const selected = i === cursor.selected;
			const parts = formatRewindParts(
				this.points[i].summary,
				Boolean(this.points[i].snapshot),
				this.points[i].timestamp,
				Date.now(),
			);
			const tone = selected ? "accent" : "meta";
			body.push(
				listRow(this.theme, w, {
					selected,
					glyph: parts.glyph,
					glyphRole: tone,
					label: parts.label,
					labelRole: tone,
					trailing: parts.trailing,
					trailingRole: tone,
				}),
			);
		}

		return dockListFrame({
			theme: this.theme,
			width: w,
			header,
			summary: clip(`  ${paint(this.theme, "meta", `${count}${SEPARATORS.item}newest first`)}`, w),
			body,
			range: cursor.clipped(this.points.length)
				? formatRange(this.theme, w, { start, end, total: this.points.length })
				: undefined,
			detail: detailLines,
			hint: this.hint(w),
		});
	}

	/** The key-hint row, with the primary action in the accent role. */
	private hint(width: number): string {
		return screenHint(this.theme, width, ["Esc close", { text: "Enter choose", color: "accent" }, "↑/↓ or k/j select"]);
	}
}

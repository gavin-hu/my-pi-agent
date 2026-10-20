/**
 * The hunk checklist `/review` opens from a modified file's diff.
 *
 * One row per textual hunk, all selected by default, so `Enter` twice reproduces
 * the whole-file revert. The screen owns only the selection: hunks in, chosen
 * indices out through `onClose`, and the reverse apply stays behind the
 * confirmation that follows.
 *
 * Pure UI: no git, no filesystem.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../lib/format.ts";
import { dockListFrame, screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { fitRows, formatRange, isCloseKey, ListCursor, navigateList, scrollList } from "../../lib/tui/cursor.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { checkbox, emptyState, listRow } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { formatReviewEntryCounts } from "./format.ts";
import type { Hunk } from "./patch.ts";

export interface HunkPickerOptions {
	/** The file the hunks belong to. */
	path: string;
	hunks: readonly Hunk[];
	theme: Theme;
	/** Called once when the screen closes: chosen hunk indices, or undefined when cancelled. */
	onClose: (selection?: number[]) => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
}

/** Rows the screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ITEMS = 12;
/** Header, summary, blank, one detail row, hint, and blank rows around the list. */
const SCREEN_CHROME_ROWS = 6;

/** The first removed and first added line, for the focused hunk's detail. */
function previewOf(hunk: Hunk): string[] {
	const removed = hunk.lines.find((line) => line.startsWith("-"));
	const added = hunk.lines.find((line) => line.startsWith("+"));
	return [removed, added].filter((line): line is string => line !== undefined).slice(0, 2);
}

/** The checklist of a file's hunks. */
export class HunkPickerComponent implements Component {
	private readonly cursor: ListCursor;
	private readonly chosen = new Set<number>();

	constructor(private readonly options: HunkPickerOptions) {
		this.cursor = new ListCursor(options.requestRender);
		// Every hunk starts selected, so confirming without touching anything means
		// "revert the file", matching the path checklist's default.
		for (let index = 0; index < options.hunks.length; index++) this.chosen.add(index);
	}

	/** Apply a key press. Exposed for the tests that drive the screen directly. */
	handleInput(data: string): void {
		if (isCloseKey(data)) {
			this.options.onClose(undefined);
			return;
		}
		if (navigateList(data, this.cursor, this.options.hunks.length)) return;
		if (data === " ") {
			const index = this.cursor.selected;
			if (this.chosen.has(index)) this.chosen.delete(index);
			else this.chosen.add(index);
			this.options.requestRender();
			return;
		}
		if (data === "a") {
			for (let index = 0; index < this.options.hunks.length; index++) this.chosen.add(index);
			this.options.requestRender();
			return;
		}
		if (data === "n") {
			this.chosen.clear();
			this.options.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.options.onClose([...this.chosen].sort((a, b) => a - b));
		}
	}

	/** Wheel scrolling in fullscreen moves the cursor; regular mode leaves the wheel to the terminal. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return scrollList(event, this.cursor, this.options.hunks.length);
	}

	dispose(): void {}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const header = titleRule(this.theme, w, "Revert hunks");
		if (this.options.hunks.length === 0) {
			return dockListFrame({
				header,
				body: emptyState(this.theme, w, { label: "No hunks to select." }),
				hint: this.hint(w),
			});
		}

		const cursor = this.cursor;
		const focused = this.options.hunks[cursor.selected];
		const preview = focused ? previewOf(focused) : [];
		cursor.visible = fitRows(
			this.options.viewportRows,
			this.options.hunks.length,
			SCREEN_CHROME_ROWS + Math.max(0, preview.length - 1),
			SCREEN_DEFAULT_ITEMS,
		);
		const { start, end } = cursor.window(this.options.hunks.length);
		const body: string[] = [];
		for (let index = start; index < end; index++) {
			const hunk = this.options.hunks[index];
			if (!hunk) continue;
			const selected = index === cursor.selected;
			body.push(
				listRow(this.theme, w, {
					selected,
					leading: checkbox(this.theme, this.chosen.has(index)),
					label: sanitizeLine(hunk.header),
					labelRole: selected ? "accent" : "label",
					trailing: formatReviewEntryCounts(hunk),
					trailingRole: "meta",
				}),
			);
		}

		return dockListFrame({
			header,
			summary: clip(
				`  ${paint(this.theme, "meta", `${this.chosen.size} of ${this.options.hunks.length} hunks selected${SEPARATORS.item}${sanitizeLine(this.options.path)}`)}`,
				w,
			),
			body,
			range: cursor.clipped(this.options.hunks.length)
				? formatRange(this.theme, w, { start, end, total: this.options.hunks.length })
				: undefined,
			detail: preview.length > 0 ? this.detail(w, preview) : undefined,
			hint: this.hint(w),
		});
	}

	private get theme(): Theme {
		return this.options.theme;
	}

	/** The focused hunk's first removed and added line. */
	private detail(width: number, preview: readonly string[]): string[] {
		return preview.map((line) => {
			const role = line.startsWith("+") ? "ok" : line.startsWith("-") ? "bad" : "meta";
			return clip(`  ${paint(this.theme, role, sanitizeLine(line))}`, width);
		});
	}

	/** The key-hint row, with the primary action in the accent role. */
	private hint(width: number): string {
		return screenHint(this.theme, width, [
			"Esc cancel",
			{ text: "Enter revert", color: "accent" },
			"Space toggle",
			"a all",
			"n none",
		]);
	}
}

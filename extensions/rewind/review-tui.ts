/**
 * The two screens `/review` opens: the changed-file list and the per-file diff.
 *
 * The list is the timeline's sibling — same dock frame, cursor, and width-safe
 * row grammar — with a status mark and line counts instead of a snapshot
 * marker. The diff is the shared `LinePane` inside the same frame, so scrolling
 * and the range row behave like `/jobs` and `/watch`.
 *
 * The screens own only their cursor, scroll, and the action they return. Git
 * reads, confirmations, and restores stay in `review.ts`, so a component never
 * mutates the working tree and a test can drive it without a repository.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { clip } from "../../lib/tui/columns.ts";
import { dockListFrame, screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { sanitizeLine } from "../../lib/format.ts";
import {
	fitRows,
	formatRange,
	isCloseKey,
	ListCursor,
	navigateList,
	scrollList,
	wheelDelta,
} from "../../lib/tui/cursor.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { LinePane } from "../../lib/tui/line-pane.ts";
import { emptyState, listRow } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint, type TuiRole } from "../../lib/tui/tokens.ts";
import { formatReviewDetail, formatReviewEntryCounts, formatReviewSummary } from "./format.ts";
import { SELECTION_MARKS, type PathChange, type ReviewEntry } from "./paths.ts";

/** Rows a list screen shows when the terminal height is unknown. */
const LIST_DEFAULT_ITEMS = 12;
/** Header, summary, blank, detail, hint, and blank rows around the list. */
const LIST_CHROME_ROWS = 6;

/** Rows a diff screen shows when the terminal height is unknown. */
const DIFF_DEFAULT_ITEMS = 20;
/** Header, summary, prompt detail, hint, and blank rows around the diff. */
const DIFF_CHROME_ROWS = 6;

/** Lines one wheel notch moves in the diff pane. */
const DIFF_WHEEL_ROWS = 3;

/** What the list returns to `review.ts`. */
export type ReviewListAction =
	| { kind: "diff"; path: string }
	| { kind: "revert"; path: string }
	| { kind: "revertAll" };

/** What the diff returns to `review.ts`. */
export type ReviewDiffAction = "back" | "revert";

/** The role for a change mark. */
function markRole(change: PathChange): TuiRole {
	if (change === "added") return "ok";
	if (change === "deleted") return "bad";
	return "meta";
}

/** The role for one diff line. Headers are checked before their `+`/`-` prefix. */
export function diffLineRole(line: string): TuiRole {
	if (line.startsWith("… diff truncated")) return "warn";
	if (line.startsWith("@@")) return "accent";
	if (
		line.startsWith("diff --git ") ||
		line.startsWith("index ") ||
		line.startsWith("--- ") ||
		line.startsWith("+++ ") ||
		line.startsWith("new file mode ") ||
		line.startsWith("deleted file mode ") ||
		line.startsWith("similarity index ") ||
		line.startsWith("rename ") ||
		line.startsWith("Binary files ")
	) {
		return "meta";
	}
	if (line.startsWith("+")) return "ok";
	if (line.startsWith("-")) return "bad";
	return "label";
}

export interface ReviewListOptions {
	entries: readonly ReviewEntry[];
	/** The prompt summary the snapshot precedes. */
	prompt?: string;
	theme: Theme;
	/** Focused row to restore when returning from a diff. */
	initialIndex?: number;
	/** Called once when the screen closes, with the chosen action or undefined. */
	onClose: (action?: ReviewListAction) => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
}

/** The changed-file list `/review` opens. */
export class ReviewListComponent implements Component {
	private readonly cursor: ListCursor;

	constructor(private readonly options: ReviewListOptions) {
		this.cursor = new ListCursor(options.requestRender);
		this.cursor.selected = Math.min(Math.max(0, options.initialIndex ?? 0), Math.max(0, options.entries.length - 1));
		// Returning from a diff can land deep in the list; put the focused row in
		// view before the first render finds a window that omits it.
		this.cursor.scrollTop = this.cursor.selected;
	}

	handleInput(data: string): void {
		if (isCloseKey(data)) {
			this.options.onClose(undefined);
			return;
		}
		if (navigateList(data, this.cursor, this.options.entries.length)) return;
		const entry = this.options.entries[this.cursor.selected];
		if (!entry) return;
		if (matchesKey(data, Key.enter)) {
			this.options.onClose({ kind: "diff", path: entry.path });
			return;
		}
		if (data === "r") {
			this.options.onClose({ kind: "revert", path: entry.path });
			return;
		}
		if (data === "R") this.options.onClose({ kind: "revertAll" });
	}

	/** Wheel scrolling in fullscreen moves the cursor; regular mode leaves the wheel to the terminal. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return scrollList(event, this.cursor, this.options.entries.length);
	}

	dispose(): void {}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const header = titleRule(this.theme, w, "Review");
		if (this.options.entries.length === 0) {
			return dockListFrame({
				header,
				body: emptyState(this.theme, w, { label: "No changes to review." }),
				hint: this.hint(w),
			});
		}

		const cursor = this.cursor;
		cursor.visible = fitRows(
			this.options.viewportRows,
			this.options.entries.length,
			LIST_CHROME_ROWS,
			LIST_DEFAULT_ITEMS,
		);
		const { start, end } = cursor.window(this.options.entries.length);
		const body: string[] = [];
		for (let index = start; index < end; index++) {
			const entry = this.options.entries[index];
			const selected = index === cursor.selected;
			body.push(
				listRow(this.theme, w, {
					selected,
					glyph: SELECTION_MARKS[entry.change],
					glyphRole: markRole(entry.change),
					label: sanitizeLine(entry.path),
					labelRole: selected ? "accent" : "label",
					trailing: formatReviewEntryCounts(entry),
					trailingRole: "meta",
				}),
			);
		}

		const focused = this.options.entries[cursor.selected];
		const label = sanitizeLine(this.options.prompt || "the last prompt");
		const summary = clip(
			`  ${paint(this.theme, "meta", `after "${label}"${SEPARATORS.item}${formatReviewSummary(this.options.entries)}`)}`,
			w,
		);
		return dockListFrame({
			header,
			summary,
			body,
			range: cursor.clipped(this.options.entries.length)
				? formatRange(this.theme, w, { start, end, total: this.options.entries.length })
				: undefined,
			detail: focused ? [clip(`  ${paint(this.theme, "meta", formatReviewDetail(focused))}`, w)] : undefined,
			hint: this.hint(w),
		});
	}

	private get theme(): Theme {
		return this.options.theme;
	}

	/** The key-hint row, with the primary action in the accent role. */
	private hint(width: number): string {
		return screenHint(this.theme, width, [
			"Esc close",
			{ text: "Enter diff", color: "accent" },
			{ text: "r revert", color: "warning" },
			"R all",
			"↑/↓ select",
		]);
	}
}

export interface ReviewDiffOptions {
	entry: ReviewEntry;
	/** The prompt summary the snapshot precedes. */
	prompt?: string;
	/** Sanitized, tab-expanded patch lines from `boundDiff`. */
	lines: readonly string[];
	theme: Theme;
	/** Called once when the screen closes, with the chosen action or undefined. */
	onClose: (action?: ReviewDiffAction) => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
}

/** One file's patch in a scrollable dock screen. */
export class ReviewDiffComponent implements Component {
	private readonly pane = new LinePane();

	constructor(private readonly options: ReviewDiffOptions) {
		this.pane.open(options.entry.path, { title: options.entry.path, lines: [...options.lines] });
		// A diff reads from its first line, unlike a log tail.
		this.pane.setScroll(0);
	}

	handleInput(data: string): void {
		if (isCloseKey(data)) {
			this.options.onClose("back");
			return;
		}
		if (data === "r") {
			this.options.onClose("revert");
			return;
		}
		if (this.pane.handleKey(data)) this.options.requestRender();
	}

	/** Wheel scrolling moves the pane; regular mode leaves the wheel to the terminal. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const delta = wheelDelta(event);
		if (delta === undefined) return undefined;
		this.pane.setScroll(this.pane.scroll + delta * DIFF_WHEEL_ROWS);
		this.options.requestRender();
		return { handled: true };
	}

	dispose(): void {}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const header = titleRule(this.theme, w, "Review");
		const total = this.pane.count;
		this.pane.visible = fitRows(this.options.viewportRows, total, DIFF_CHROME_ROWS, DIFF_DEFAULT_ITEMS);
		this.pane.fit(this.pane.visible);
		const { start, end } = this.pane.window();
		const body = this.options.lines
			.slice(start, end)
			.map((line) => clip(paint(this.theme, diffLineRole(line), line), w));
		if (body.length === 0) body.push(...emptyState(this.theme, w, { label: "No textual diff." }));

		const entry = this.options.entry;
		const summary = clip(
			`  ${paint(this.theme, "meta", `${sanitizeLine(entry.path)}${SEPARATORS.item}${SELECTION_MARKS[entry.change]}${SEPARATORS.item}${formatReviewEntryCounts(entry)}`)}`,
			w,
		);
		const label = sanitizeLine(this.options.prompt || "the last prompt");
		return dockListFrame({
			header,
			summary,
			body,
			range: start > 0 || end < total ? formatRange(this.theme, w, { start, end, total, label: "line" }) : undefined,
			detail: [clip(`  ${paint(this.theme, "meta", `after "${label}"`)}`, w)],
			hint: this.hint(w),
		});
	}

	private get theme(): Theme {
		return this.options.theme;
	}

	/** The key-hint row, with revert in the warn role. */
	private hint(width: number): string {
		return screenHint(this.theme, width, [
			"Esc back",
			{ text: "r revert file", color: "warning" },
			"j/k scroll",
			"g/G top/end",
		]);
	}
}

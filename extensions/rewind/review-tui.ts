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
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { clip } from "../../lib/tui/columns.ts";
import { detailBlockRows, dockListFrame, screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { fitRows, formatRange, isCloseKey, wheelDelta } from "../../lib/tui/cursor.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { LinePane } from "../../lib/tui/line-pane.ts";
import { checkbox, emptyState, listRow } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint, type TuiRole } from "../../lib/tui/tokens.ts";
import { ChecklistScreen } from "./checklist.ts";
import { formatReviewDetail, formatReviewEntryCounts, formatReviewSummary } from "./format.ts";
import { SELECTION_MARKS, type PathChange, type ReviewEntry } from "./paths.ts";

/** Rows a diff screen shows when the terminal height is unknown. */
const DIFF_DEFAULT_ITEMS = 20;
/** Header, summary, blank, blank, hint, and blank rows around the diff. */
const DIFF_CHROME_ROWS = 6;

/** Lines one wheel notch moves in the diff pane. */
const DIFF_WHEEL_ROWS = 3;

/** What the list returns to `review.ts`. */
export type ReviewListAction =
	| { kind: "diff"; path: string }
	| { kind: "revert"; paths: string[] }
	| { kind: "revertAll" };

/** The list's close result: the action and the selection to restore next time. */
export interface ReviewListResult {
	action?: ReviewListAction;
	selected: string[];
}

/** What the diff returns to `review.ts`. */
export type ReviewDiffAction = "back" | "revert" | "hunks";

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
	/** Rows selected before this mount, e.g. after returning from a diff. */
	initialSelected?: readonly string[];
	/** Whether the working tree is clean against HEAD, so the diff is all committed. */
	committed?: boolean;
	/** Called once when the screen closes, with the action and the current selection. */
	onClose: (result: ReviewListResult) => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
}

/** The changed-file list `/review` opens. */
export class ReviewListComponent extends ChecklistScreen<ReviewEntry> {
	private readonly view: ReviewListOptions;

	constructor(view: ReviewListOptions) {
		super({
			title: "Review",
			theme: view.theme,
			requestRender: view.requestRender,
			viewportRows: view.viewportRows,
			emptyLabel: "No changes to review.",
		});
		this.view = view;
		this.cursor.selected = Math.min(Math.max(0, view.initialIndex ?? 0), Math.max(0, view.entries.length - 1));
		// Returning from a diff can land deep in the list; put the focused row in
		// view before the first render finds a window that omits it.
		this.cursor.scrollTop = this.cursor.selected;
	}

	protected rows(): readonly ReviewEntry[] {
		return this.view.entries;
	}

	protected keyOf(entry: ReviewEntry): string {
		return entry.path;
	}

	protected initialSelection(): readonly string[] {
		const present = new Set(this.view.entries.map((entry) => entry.path));
		return (this.view.initialSelected ?? []).filter((path) => present.has(path));
	}

	/** Close with an action and the current selection. */
	private close(action?: ReviewListAction): void {
		this.view.onClose({ action, selected: [...this.chosen] });
	}

	protected onEnter(): void {
		const entry = this.focused;
		if (entry) this.close({ kind: "diff", path: entry.path });
	}

	protected onCancel(): void {
		this.close();
	}

	protected verb(data: string): void {
		const entry = this.focused;
		if (!entry) return;
		if (data === "r") {
			const paths = this.chosen.size > 0 ? [...this.chosen] : [entry.path];
			this.close({ kind: "revert", paths });
			return;
		}
		if (data === "R") this.close({ kind: "revertAll" });
	}

	protected rowLine(entry: ReviewEntry, width: number, selected: boolean): string {
		return listRow(this.theme, width, {
			selected,
			leading: checkbox(this.theme, this.chosen.has(entry.path)),
			glyph: SELECTION_MARKS[entry.change],
			glyphRole: markRole(entry.change),
			label: sanitizeLine(entry.path),
			labelRole: selected ? "accent" : "label",
			trailing: formatReviewEntryCounts(entry),
			trailingRole: "meta",
		});
	}

	protected summaryText(): string {
		const label = sanitizeLine(this.view.prompt || "the last prompt");
		const parts = [formatReviewSummary(this.view.entries, this.chosen.size)];
		if (this.view.committed) parts.push("committed");
		return `after "${label}"${SEPARATORS.item}${parts.join(SEPARATORS.item)}`;
	}

	protected detailLines(width: number): string[] {
		const detail: string[] = [];
		const focused = this.focused;
		if (focused) detail.push(clip(`  ${paint(this.theme, "meta", formatReviewDetail(focused))}`, width));
		const selectionLine =
			this.chosen.size > 0
				? `r reverts ${this.chosen.size} selected file${this.chosen.size === 1 ? "" : "s"}; R reverts all.`
				: undefined;
		const committedLine = this.view.committed
			? "These changes are already committed; reverting rewrites the working tree only."
			: undefined;
		for (const line of [selectionLine, committedLine]) {
			if (line) detail.push(clip(`  ${paint(this.theme, "meta", line)}`, width));
		}
		return detail;
	}

	/** The key-hint row, with the primary action in the accent role. */
	protected hint(width: number): string {
		return screenHint(this.theme, width, [
			"Esc close",
			{ text: "Enter diff", color: "accent" },
			"Space select",
			{ text: "r revert", color: "warning" },
			{ text: "R all", color: "warning" },
			"a/n all/none",
		]);
	}
}

export interface ReviewDiffOptions {
	entry: ReviewEntry;
	/** The prompt summary the snapshot precedes. */
	prompt?: string;
	/** Sanitized, tab-expanded patch lines from `boundDiff`. */
	lines: readonly string[];
	/** Whether this file has textual hunks that can be reverted selectively. */
	canRevertHunks?: boolean;
	/** Whether the working tree is clean against HEAD, so the diff is all committed. */
	committed?: boolean;
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
		if (data === "h" && this.options.canRevertHunks) {
			this.options.onClose("hunks");
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
		const entry = this.options.entry;
		const total = this.pane.count;
		const summary = clip(
			`  ${paint(this.theme, "meta", `${sanitizeLine(entry.path)}${SEPARATORS.item}${SELECTION_MARKS[entry.change]}${SEPARATORS.item}${formatReviewEntryCounts(entry)}`)}`,
			w,
		);
		const label = sanitizeLine(this.options.prompt || "the last prompt");
		const detail = [clip(`  ${paint(this.theme, "meta", `after "${label}"`)}`, w)];
		if (entry.change === "renamed") {
			detail.push(clip(`  ${paint(this.theme, "meta", `renamed from ${sanitizeLine(entry.from)}`)}`, w));
		}
		if (this.options.committed) {
			detail.push(
				clip(
					`  ${paint(this.theme, "meta", "These changes are already committed; reverting rewrites the working tree only.")}`,
					w,
				),
			);
		}
		this.pane.visible = fitRows(
			this.options.viewportRows,
			total,
			DIFF_CHROME_ROWS + detailBlockRows(detail),
			DIFF_DEFAULT_ITEMS,
		);
		this.pane.fit(this.pane.visible);
		const { start, end } = this.pane.window();
		const body = this.options.lines
			.slice(start, end)
			.map((line) => clip(paint(this.theme, diffLineRole(line), line), w));
		if (body.length === 0) body.push(...emptyState(this.theme, w, { label: "No textual diff." }));

		return dockListFrame({
			header,
			summary,
			body,
			range: start > 0 || end < total ? formatRange(this.theme, w, { start, end, total, label: "line" }) : undefined,
			detail,
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
			...(this.options.canRevertHunks ? [{ text: "h hunks", color: "accent" as const }] : []),
			{ text: "r revert file", color: "warning" },
			"j/k scroll",
			"g/G top/end",
		]);
	}
}

/**
 * The `/plan list` surface: the plan index as a notice, and as a docked list
 * screen.
 *
 * A plan is a file, and the plans directory is its only index, so this module
 * presents what `PlanStore.index` walked: the title, the modified time, and how
 * far its steps got, newest first. Enter on the screen hands the focused plan
 * back to the caller, which reuses the browser review; every other mode gets the
 * same facts as one line per plan, with the path to reopen.
 *
 * Derived state only: the summaries are passed in, a reload replaces them, and a
 * render reads them — like the `/memory` picker.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { sanitizeLine, shortenPath } from "../../lib/format.ts";
import { fitRows, formatRange, isCloseKey, ListCursor, navigateList, scrollList } from "../../lib/tui/cursor.ts";
import { dockListFrame, screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { emptyState, listRow } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint } from "../../lib/tui/tokens.ts";
import type { PlanSummary } from "./plans.ts";

/** Rows the screen shows when the terminal height is unknown. */
const DEFAULT_ROWS = 14;
/** Fixed rows around the list: header, summary, blank, range, detail, hint, closing rule. */
const CHROME = 7;
/** Longest title a row draws before the trailing meta wins the column. */
const TITLE_WIDTH = 56;

/**
 * How long ago a plan was modified: `today`, `3d ago`, `2mo ago`, `1y ago`.
 * Coarse on purpose — a list row compares plans, it does not time them.
 */
export function relativeAge(modifiedMs: number, nowMs: number): string {
	const days = Math.floor(Math.max(0, nowMs - modifiedMs) / 86_400_000);
	if (days < 1) return "today";
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(days / 365)}y ago`;
}

/** `3/7 steps`, `2/2 steps`, or `steps unknown` for a file the store would not have written. */
function stepsText(summary: PlanSummary): string {
	if (!summary.steps) return "steps unknown";
	return `${summary.steps.done}/${summary.steps.total} steps`;
}

/** Local `YYYY-MM-DD HH:mm`, matching the stamp the file name carries. */
function localTime(ms: number): string {
	const date = new Date(ms);
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The non-TUI listing: one line per plan with its title, step progress, modified
 * time, and path, newest first. The directory is named once in the header.
 */
export function formatPlanIndex(summaries: readonly PlanSummary[], dir: string): string {
	const where = sanitizeLine(shortenPath(dir));
	if (summaries.length === 0) {
		return `No plans in ${where} yet; write_plan saves one there.`;
	}
	const lines = summaries.map(
		(summary) =>
			`  ${sanitizeLine(summary.title)} — ${stepsText(summary)} — ${localTime(summary.modified)} — ${sanitizeLine(summary.relativePath)}`,
	);
	return [`Plans (${summaries.length}) — ${where}`, ...lines].join("\n");
}

export interface PlanIndexOptions {
	summaries: readonly PlanSummary[];
	/** Directory the plans live in, for the header. */
	dir: string;
	theme: Theme;
	/** Enter on the focused plan; the caller opens its review after the screen closes. */
	onSelect: (summary: PlanSummary) => void;
	onClose: () => void;
	/** `r`: re-read the directory. Resolves with the new rows. */
	reload: () => Promise<readonly PlanSummary[]>;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
	/** Clock for the relative ages; defaults to the wall clock. */
	now?: () => number;
}

/** Docked `/plan list` screen: the plans directory, newest first. */
export class PlanIndexComponent implements Component {
	private readonly cursor: ListCursor;
	private summaries: readonly PlanSummary[];
	private notice: string | undefined;
	private componentFocused = false;

	constructor(private readonly options: PlanIndexOptions) {
		this.summaries = options.summaries;
		this.cursor = new ListCursor(() => options.requestRender());
		// A screen can take its first key before it is drawn; keep the cursor valid.
		this.cursor.sync(this.summaries.length);
	}

	/** Replace the rows after a reload, keeping the focused plan if it is still there. */
	private setSummaries(next: readonly PlanSummary[]): void {
		this.summaries = next;
		this.cursor.sync(next.length);
		this.cursor.selected = Math.min(this.cursor.selected, Math.max(0, next.length - 1));
		this.requestRender();
	}

	private requestRender(): void {
		this.options.requestRender();
	}

	private reload(): void {
		void this.options
			.reload()
			.then((next) => {
				this.setSummaries(next);
				this.notice = next.length === 0 ? "No plans yet." : undefined;
			})
			.catch((error: unknown) => {
				this.notice = `Could not read the plans directory: ${error instanceof Error ? error.message : String(error)}`;
				this.requestRender();
			});
	}

	handleInput(data: string): void {
		if (isCloseKey(data) || data === "q") {
			this.options.onClose();
			return;
		}
		if (this.notice !== undefined) this.notice = undefined;

		if (navigateList(data, this.cursor, this.summaries.length)) {
			this.requestRender();
			return;
		}
		// The hint advertises `g`/`G`, so bind them to the ends.
		if (data === "g" || data === "G") {
			this.cursor.set(data === "g" ? 0 : this.summaries.length - 1, this.summaries.length);
			this.requestRender();
			return;
		}
		if (data === "r") {
			this.reload();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const focused = this.summaries[this.cursor.selected];
			if (focused) this.options.onSelect(focused);
		}
	}

	/** Wheel scrolling moves the selection, matching the other list screens. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return scrollList(event, this.cursor, this.summaries.length);
	}

	/** Rows are built per render from the current theme and summaries; nothing is memoized. */
	invalidate(): void {}

	get focused(): boolean {
		return this.componentFocused;
	}

	set focused(value: boolean) {
		this.componentFocused = value;
	}

	private row(summary: PlanSummary, selected: boolean, width: number): string {
		const now = (this.options.now ?? Date.now)();
		const trailing = `${stepsText(summary)} · ${relativeAge(summary.modified, now)}`;
		return listRow(this.options.theme, width, {
			selected,
			label: clip(sanitizeLine(summary.title), TITLE_WIDTH),
			labelRole: selected ? "accent" : "label",
			trailing,
			trailingRole: "meta",
		});
	}

	private summaryLine(width: number): string {
		const { theme } = this.options;
		const count = this.summaries.length;
		const text = `${paint(theme, "accent", "Plans")} ${paint(theme, "meta", `· ${count} ${count === 1 ? "plan" : "plans"}`)}`;
		const where = paint(theme, "faint", ` · ${sanitizeLine(shortenPath(this.options.dir))}`);
		return clip(`  ${text}${where}`, width);
	}

	private detailLines(width: number): string[] {
		const focused = this.summaries[this.cursor.selected];
		if (!focused) return [];
		const { theme } = this.options;
		const path = paint(theme, "meta", sanitizeLine(focused.relativePath));
		const time = paint(theme, "faint", ` · modified ${localTime(focused.modified)}`);
		return [clip(`  ${path}${time}`, width)];
	}

	render(width: number): string[] {
		const { theme } = this.options;
		const w = Math.max(1, width);
		this.cursor.visible = fitRows(this.options.viewportRows, this.summaries.length, CHROME, DEFAULT_ROWS);
		this.cursor.sync(this.summaries.length);

		const body: string[] = [];
		if (this.summaries.length === 0) {
			body.push(...emptyState(theme, w, { label: "No plans yet. write_plan saves one under .pi/plans." }));
		} else {
			const { start, end } = this.cursor.window(this.summaries.length);
			for (let index = start; index < end; index++) {
				body.push(this.row(this.summaries[index], index === this.cursor.selected, w));
			}
		}

		const hint =
			this.notice !== undefined
				? clip(`  ${paint(theme, "meta", this.notice)}`, w)
				: screenHint(theme, w, ["Esc close", { text: "Enter review", color: "accent" }, "r reload", "↑/↓", "g/G"]);

		return dockListFrame({
			theme,
			width: w,
			header: titleRule(theme, w, "Plan index"),
			summary: this.summaryLine(w),
			body,
			range: this.cursor.clipped(this.summaries.length)
				? formatRange(theme, w, { ...this.cursor.window(this.summaries.length), total: this.summaries.length })
				: undefined,
			detail: this.detailLines(w),
			hint,
		});
	}
}

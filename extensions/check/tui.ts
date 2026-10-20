/**
 * The two check screens: a live run tail and a navigable failure list.
 *
 * `CheckRunComponent` owns only a `LinePane` over the runtime's live lines;
 * `CheckResultComponent` owns a list cursor and a detail pane built from the
 * failure and the bounded tail. Git reads, parsing, and process lifecycle stay
 * in `runtime.ts`, so both components can be tested without a process.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { formatDuration } from "../../lib/format.ts";
import { dockListFrame, screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
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
import { paint } from "../../lib/tui/tokens.ts";
import { formatFailureDetail, formatFailureLocation, formatResultSummary } from "./format.ts";
import { sanitizeLine } from "../../lib/format.ts";
import type { CheckResult, Failure } from "./types.ts";

const RUN_DEFAULT_ROWS = 20;
const RUN_CHROME_ROWS = 5;
const RESULT_DEFAULT_ROWS = 12;
const RESULT_CHROME_ROWS = 6;
const DETAIL_DEFAULT_ROWS = 20;
const DETAIL_CHROME_ROWS = 5;

export interface CheckRunOptions {
	command: string;
	lines: () => readonly string[];
	elapsedMs: () => number;
	theme: Theme;
	onCancel: () => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
}

/** The live run screen: a tail, a status summary, and a cancel key. */
export class CheckRunComponent implements Component {
	private readonly pane = new LinePane();

	constructor(private readonly options: CheckRunOptions) {
		this.pane.open("check", { title: options.command, lines: [] });
	}

	handleInput(data: string): void {
		if (isCloseKey(data)) {
			this.options.onCancel();
			return;
		}
		if (this.pane.handleKey(data)) this.options.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const delta = wheelDelta(event);
		if (delta === undefined) return undefined;
		this.pane.setScroll(this.pane.scroll + delta * 3);
		this.options.requestRender();
		return { handled: true };
	}

	dispose(): void {}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const lines = [...this.options.lines()];
		this.pane.update({ lines });
		this.pane.visible = fitRows(this.options.viewportRows, lines.length, RUN_CHROME_ROWS, RUN_DEFAULT_ROWS);
		this.pane.fit(this.pane.visible);
		const { start, end } = this.pane.window();
		const body = lines.slice(start, end).map((line) => {
			const role = line.startsWith("$ ") ? "accent" : "label";
			return clip(paint(this.theme, role, line), w);
		});
		if (body.length === 0) body.push(...emptyState(this.theme, w, { label: "Starting…" }));
		return dockListFrame({
			header: titleRule(this.theme, w, "Check"),
			summary: clip(
				`  ${paint(this.theme, "meta", `running${SEPARATORS.item}${sanitizeLine(this.options.command)}${SEPARATORS.item}${formatDuration(this.options.elapsedMs())}`)}`,
				w,
			),
			body,
			range:
				start > 0 || end < lines.length
					? formatRange(this.theme, w, { start, end, total: lines.length, label: "line" })
					: undefined,
			hint: screenHint(this.theme, w, ["Esc cancel", "j/k scroll", "g/G top/end"]),
		});
	}

	private get theme(): Theme {
		return this.options.theme;
	}
}

export interface CheckResultOptions {
	result: CheckResult;
	theme: Theme;
	onRerun: () => void;
	onClose: () => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
}

/** The failure list, with a per-failure detail phase. */
export class CheckResultComponent implements Component {
	private readonly cursor: ListCursor;
	private readonly pane = new LinePane();
	private phase: "list" | "detail" = "list";
	private detailFailure: Failure | undefined;

	constructor(private readonly options: CheckResultOptions) {
		this.cursor = new ListCursor(options.requestRender);
	}

	handleInput(data: string): void {
		if (this.phase === "detail") {
			if (isCloseKey(data)) {
				this.phase = "list";
				this.options.requestRender();
				return;
			}
			if (this.pane.handleKey(data)) this.options.requestRender();
			return;
		}
		if (isCloseKey(data)) {
			this.options.onClose();
			return;
		}
		if (navigateList(data, this.cursor, this.options.result.failures.length)) return;
		if (matchesKey(data, Key.enter)) {
			const failure = this.options.result.failures[this.cursor.selected];
			if (failure) this.openDetail(failure);
			return;
		}
		if (data === "r") this.options.onRerun();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.phase === "detail") {
			const delta = wheelDelta(event);
			if (delta === undefined) return undefined;
			this.pane.setScroll(this.pane.scroll + delta * 3);
			this.options.requestRender();
			return { handled: true };
		}
		return scrollList(event, this.cursor, this.options.result.failures.length);
	}

	dispose(): void {}

	invalidate(): void {}

	private openDetail(failure: Failure): void {
		this.pane.open(failure.path ?? failure.test ?? "check", {
			title: formatFailureLocation(failure),
			lines: formatFailureDetail(failure, this.options.result.tail),
		});
		this.pane.setScroll(0);
		this.detailFailure = failure;
		this.phase = "detail";
		this.options.requestRender();
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const header = titleRule(this.theme, w, "Check");
		const result = this.options.result;
		const summary = clip(`  ${paint(this.theme, "meta", formatResultSummary(result))}`, w);

		if (this.phase === "detail") {
			const total = this.pane.count;
			this.pane.visible = fitRows(this.options.viewportRows, total, DETAIL_CHROME_ROWS, DETAIL_DEFAULT_ROWS);
			this.pane.fit(this.pane.visible);
			const { start, end } = this.pane.window();
			const body = this.pane.lines.slice(start, end).map((line) => clip(paint(this.theme, "label", line), w));
			const detailSummary = this.detailFailure
				? `${formatFailureLocation(this.detailFailure)}${SEPARATORS.item}${sanitizeLine(this.detailFailure.command)}`
				: formatResultSummary(result);
			return dockListFrame({
				header,
				summary: clip(`  ${paint(this.theme, "meta", detailSummary)}`, w),
				body,
				range: start > 0 || end < total ? formatRange(this.theme, w, { start, end, total, label: "line" }) : undefined,
				hint: screenHint(this.theme, w, ["Esc back", "j/k scroll", "g/G top/end"]),
			});
		}

		if (result.failures.length === 0) {
			return dockListFrame({
				header,
				summary,
				body: emptyState(this.theme, w, { label: "No failures parsed." }),
				hint: screenHint(this.theme, w, ["Esc close", { text: "r rerun", color: "accent" }]),
			});
		}

		const cursor = this.cursor;
		cursor.visible = fitRows(
			this.options.viewportRows,
			result.failures.length,
			RESULT_CHROME_ROWS,
			RESULT_DEFAULT_ROWS,
		);
		const { start, end } = cursor.window(result.failures.length);
		const body: string[] = [];
		for (let index = start; index < end; index++) {
			const failure = result.failures[index];
			const selected = index === cursor.selected;
			body.push(
				listRow(this.theme, w, {
					selected,
					glyph: "✗",
					glyphRole: "bad",
					label: formatFailureLocation(failure),
					labelRole: selected ? "accent" : "label",
					trailing: "",
				}),
			);
		}
		const focused = result.failures[cursor.selected];
		return dockListFrame({
			header,
			summary,
			body,
			range: cursor.clipped(result.failures.length)
				? formatRange(this.theme, w, { start, end, total: result.failures.length })
				: undefined,
			detail: focused ? [clip(`  ${paint(this.theme, "meta", sanitizeLine(focused.message))}`, w)] : undefined,
			hint: screenHint(this.theme, w, [
				"Esc close",
				{ text: "Enter detail", color: "accent" },
				{ text: "r rerun", color: "warning" },
				"↑/↓ select",
			]),
		});
	}

	private get theme(): Theme {
		return this.options.theme;
	}
}

/**
 * The two check screens: a live run tail and a navigable failure list.
 *
 * `CheckRunComponent` owns only a `LinePane` over the runtime's live lines;
 * `CheckResultComponent` is a `DockListScreen`, so the frame, the id-anchored
 * cursor, the navigation keys, the range row, and the detail pane come from the
 * shared base and nothing here draws chrome. Git reads, parsing, and process
 * lifecycle stay in `runtime.ts`, so both components can be tested without a
 * process.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { formatDuration, sanitizeLine } from "../../lib/format.ts";
import { dockListFrame, screenHint, type ScreenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { fitRows, formatRange, isCloseKey, wheelDelta } from "../../lib/tui/cursor.ts";
import { DockListScreen, type DetailContents } from "../../lib/tui/dock-screen.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { LinePane } from "../../lib/tui/line-pane.ts";
import { emptyState, listRow } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { formatFailureDetail, formatFailureLocation, formatResultSummary } from "./format.ts";
import { readSourceExcerpt } from "./source.ts";
import type { CheckResult, Failure } from "./types.ts";

const RUN_DEFAULT_ROWS = 20;
const RUN_CHROME_ROWS = 5;

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
			theme: this.theme,
			width: w,
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
	/** Project root used to read a failure's source excerpt. */
	cwd: string;
	theme: Theme;
	onRerun: () => void;
	onClose: () => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
}

/**
 * The failure list, with a per-failure detail pane.
 *
 * A failure carries no id of its own, but a finished run's `failures` array is
 * fixed for the life of this screen, so the index is a stable cursor key. It is
 * mapped once in the constructor: an `indexOf` per row per frame would be
 * quadratic on the 200-failure cap.
 */
export class CheckResultComponent extends DockListScreen<Failure> {
	private readonly ids = new Map<Failure, string>();

	constructor(private readonly view: CheckResultOptions) {
		super({
			theme: view.theme,
			title: "Check",
			detailTitle: "Failure",
			emptyList: "No failures parsed.",
			emptyDetail: "Nothing to show.",
			requestRender: view.requestRender,
			onClose: view.onClose,
			viewportRowsSource: view.viewportRows,
		});
		view.result.failures.forEach((failure, index) => this.ids.set(failure, String(index)));
	}

	protected rows(): readonly Failure[] {
		return this.view.result.failures;
	}

	protected idOf(failure: Failure): string {
		return this.ids.get(failure) ?? "0";
	}

	protected rowLine(failure: Failure, width: number, selected: boolean): string {
		return listRow(this.theme, width, {
			selected,
			glyph: "✗",
			glyphRole: "bad",
			label: formatFailureLocation(failure),
			labelRole: selected ? "accent" : "label",
			trailing: "",
		});
	}

	protected detailBlock(failure: Failure): string[] {
		return [sanitizeLine(failure.message)];
	}

	protected summaryCells(): string[] {
		return [paint(this.theme, "meta", formatResultSummary(this.view.result))];
	}

	protected listHints(rows: readonly Failure[]): ScreenHint[] {
		// An empty list has nothing to open, so it offers only the two ways out.
		if (rows.length === 0) return ["Esc close", { text: "r rerun", color: "accent" }];
		return [
			"Esc close",
			{ text: "Enter detail", color: "accent" },
			{ text: "r rerun", color: "warning" },
			"↑/↓ select",
		];
	}

	protected detailHints(): ScreenHint[] {
		return ["Esc back", "j/k scroll", "g/G top/end"];
	}

	protected detailFor(failure: Failure): DetailContents {
		// The excerpt is read once, when the pane opens, as it always has been.
		const source = failure.path ? readSourceExcerpt(this.view.cwd, failure) : undefined;
		return {
			title: formatFailureLocation(failure),
			// The base clips a detail line but never paints it, so the body keeps the
			// role this screen gave it.
			lines: formatFailureDetail(failure, this.view.result.tail, source).map((line) =>
				paint(this.theme, "label", line),
			),
		};
	}

	protected handleVerb(key: string): void {
		if (key === "r") this.view.onRerun();
	}
}

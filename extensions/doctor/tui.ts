/**
 * The `/doctor` TUI screen.
 *
 * One row per extension with a severity glyph, plus a detail pane for the
 * focused row. It stays in the dock's editor slot like `/jobs` and `/rewind`,
 * so the transcript stays visible; `Esc` closes it.
 *
 * The screen holds no themed strings: `render` reads the live report each time
 * and `invalidate` has nothing to rebuild. Report text comes from `format.ts`,
 * which sanitizes everything that originated in a probe.
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
import { fitRows, formatRange, ListCursor, navIntent, wheelDelta } from "../../lib/list-cursor.ts";
import { screenHeader, screenHint } from "../../lib/tui.ts";
import type { ExtensionReport } from "../../lib/requirements.ts";
import { countFindings, detailLines, extensionRow } from "./format.ts";

/** Body rows when the terminal height is unknown. */
const SCREEN_DEFAULT_ROWS = 12;
/** Rows reserved for the focused extension's detail pane. */
const DETAIL_ROWS = 4;
/** Fixed rows around the list: header, blank, detail label, hint. */
const CHROME = 4;

export interface DoctorScreenOptions {
	/** Current reports; read on every render so a refresh is picked up. */
	reports: () => ExtensionReport[];
	/** Live terminal height, for the row budget. */
	rows: () => number | undefined;
	theme: Theme;
	requestRender: () => void;
	/** Re-probe with `refresh` and update `reports`. */
	refresh: () => void;
	/** Close the screen. */
	done: () => void;
}

/** The docked `/doctor` list screen. */
export class DoctorScreen implements Component {
	private readonly cursor: ListCursor;
	private showAll = false;

	constructor(private readonly options: DoctorScreenOptions) {
		this.cursor = new ListCursor(() => this.options.requestRender());
	}

	invalidate(): void {}

	/** Re-probe and drop back to the compact detail view. */
	refresh(): void {
		this.showAll = false;
		this.options.refresh();
	}

	private count(): number {
		return this.options.reports().length;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.options.done();
			return;
		}
		if (data === "r") {
			this.refresh();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.showAll = !this.showAll;
			this.options.requestRender();
			return;
		}

		const intent = navIntent(data);
		if (!intent) return;
		const count = this.count();
		if (intent === "up") this.cursor.by(-1, count);
		else if (intent === "down") this.cursor.by(1, count);
		else if (intent === "pageUp") this.cursor.page(-1, count);
		else if (intent === "pageDown") this.cursor.page(1, count);
		else if (intent === "home") this.cursor.set(0, count);
		else this.cursor.set(count - 1, count);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const delta = wheelDelta(event);
		if (delta === undefined) return undefined;
		this.cursor.by(delta, this.count());
		return { handled: true };
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const reports = this.options.reports();
		const count = reports.length;

		this.cursor.visible = Math.max(1, fitRows(this.options.rows(), count, CHROME + DETAIL_ROWS, SCREEN_DEFAULT_ROWS));
		this.cursor.sync(count);
		const window = this.cursor.window(count);

		const lines: string[] = [screenHeader(this.options.theme, w, "doctor")];
		for (let index = window.start; index < window.end; index += 1) {
			const report = reports[index];
			if (report) lines.push(extensionRow(report, this.options.theme, w, index === this.cursor.selected));
		}
		lines.push("");

		const focused = reports[this.cursor.selected];
		const counts = countFindings(focused ? [focused] : []);
		const label = focused
			? `  ${focused.extension} — ${counts.missing} missing, ${counts.degraded} degraded`
			: "  no extensions to report";
		lines.push(truncateToWidth(this.options.theme.fg("dim", label), w));
		lines.push(...detailLines(focused, this.options.theme, w, DETAIL_ROWS, this.showAll));

		if (this.cursor.clipped(count)) {
			lines.push(formatRange(this.options.theme, w, { start: window.start, end: window.end, total: count }));
		}
		lines.push(
			screenHint(this.options.theme, w, [
				"Esc close",
				"↑/↓ select",
				this.showAll ? "Enter problems" : "Enter all checks",
				"r refresh",
			]),
		);
		return lines;
	}
}

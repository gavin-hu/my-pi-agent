/**
 * Terminal rendering for jobs.
 *
 * `JobsWidget` is the persistent, non-interactive list shown above the editor
 * while jobs run or an unreported failure waits; `JobListComponent` is the
 * dismissible `/jobs` screen with a focused detail pane and a log view. Both are
 * stateless with respect to time: elapsed values are computed from `Date.now()`
 * at render, so the runtime only has to call `requestRender()`, never rebuild
 * the component.
 *
 * Every line is clipped with `truncateToWidth`; log text arrives already
 * sanitized by the runtime, so no untrusted escape sequence reaches the
 * terminal through here.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { screenHeader, screenHint, viewportRows, type ViewportRowsSource } from "../_shared/tui.ts";
import {
	compareJobs,
	elapsedMs,
	formatDuration,
	formatJobDetail,
	jobCounts,
	pendingFailures,
	shortLabel,
	statusGlyph,
	type JobCounts,
} from "./format.ts";
import type { JobRecord } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "jobs-widget";

/** Rows the `/jobs` screen body shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ROWS = 14;

/** The `❯ ` selection marker (accent) or a same-width blank. */
function rowMarker(theme: Theme, selected: boolean): string {
	return selected ? theme.fg("accent", "❯ ") : "  ";
}

/**
 * One job row: selection marker, status glyph, id, label, and a right-aligned
 * elapsed value. The label is padded so the elapsed column lines up; the final
 * `truncateToWidth` keeps the row safe at any width.
 */
function jobRow(job: JobRecord, theme: Theme, width: number, selected = false): string {
	const head = `${rowMarker(theme, selected)}${statusGlyph(job.status, theme)} ${job.id}  `;
	const elapsed = formatDuration(elapsedMs(job, Date.now()));
	const available = Math.max(1, width - visibleWidth(head) - elapsed.length - 1);
	const clipped = truncateToWidth(shortLabel(job), available, "…");
	const pad = " ".repeat(Math.max(0, available - visibleWidth(clipped)));
	return truncateToWidth(`${head}${clipped}${pad} ${theme.fg("dim", elapsed)}`, width);
}

/** Rails-style widget header: `Jobs · N running · M failed`. */
function widgetHeader(theme: Theme, running: number, failed: number): string {
	const parts: string[] = [];
	if (running > 0) parts.push(theme.fg("dim", `${running} running`));
	if (failed > 0) parts.push(theme.fg("error", `${failed} failed`));
	const head = theme.fg("accent", "Jobs");
	return parts.length === 0 ? head : `${head} ${theme.fg("dim", "·")} ${parts.join(` ${theme.fg("dim", "·")} `)}`;
}

/** Persistent one-line widget shown while jobs run or a completion is unreported. */
export class JobsWidget implements Component {
	constructor(
		private readonly jobs: () => Iterable<JobRecord>,
		private readonly theme: Theme,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const all = [...this.jobs()];
		const running = all.filter((job) => job.status === "running").length;
		const failed = pendingFailures(all).length;
		if (running === 0 && failed === 0) return [];
		return [truncateToWidth(widgetHeader(this.theme, running, failed), w)];
	}
}

export interface JobListCallbacks {
	/** Current sanitized log lines for a job, or undefined when unknown. */
	logs(id: string): { lines: string[] } | undefined;
	kill(id: string): void;
	clear(): void;
}

/** Dismissible `/jobs` screen: a selectable list with a focus pane and log view. */
export class JobListComponent implements Component {
	private mode: "list" | "logs" = "list";
	private selected = 0;
	private listScroll = 0;
	private logScroll = 0;
	private logLines: string[] = [];
	private logTitle = "";
	private follow = true;
	/** Rows shown at once; recomputed from the terminal height on every render. */
	private visible = SCREEN_DEFAULT_ROWS;

	constructor(
		private readonly jobs: () => JobRecord[],
		private readonly theme: Theme,
		private readonly callbacks: JobListCallbacks,
		private readonly onClose: () => void,
		private readonly requestRender: () => void,
		private readonly viewportRowsSource?: ViewportRowsSource,
	) {}

	invalidate(): void {}

	/** Replace the log pane contents (called by the command's poll loop). */
	setLogs(title: string, lines: string[]): void {
		this.logTitle = title;
		this.logLines = lines;
		if (this.follow) this.logScroll = this.maxLogScroll;
		else this.logScroll = Math.min(this.logScroll, this.maxLogScroll);
		this.requestRender();
	}

	/** The job whose log pane is open, or undefined in list mode. */
	currentLogId(): string | undefined {
		if (this.mode !== "logs") return undefined;
		return this.ordered[this.selected]?.id;
	}

	/** Re-read the open log pane from the runtime. */
	refreshLogs(id: string): void {
		const result = this.callbacks.logs(id);
		if (result) this.setLogs(this.logTitle, result.lines);
	}

	private get ordered(): JobRecord[] {
		return [...this.jobs()].sort(compareJobs);
	}

	private get maxLogScroll(): number {
		return Math.max(0, this.logLines.length - this.visible);
	}

	/** Row count that fits, reserving one more line when a range row is needed. */
	private fitRows(itemCount: number, chrome: number): number {
		let visible = viewportRows(this.viewportRowsSource, { chrome, fallback: SCREEN_DEFAULT_ROWS });
		if (itemCount > visible) {
			visible = viewportRows(this.viewportRowsSource, { chrome: chrome + 1, fallback: SCREEN_DEFAULT_ROWS });
		}
		return visible;
	}

	private setSelection(next: number): void {
		const count = this.ordered.length;
		if (count === 0) return;
		this.selected = Math.min(Math.max(0, next), count - 1);
		if (this.selected < this.listScroll) this.listScroll = this.selected;
		else if (this.selected >= this.listScroll + this.visible) this.listScroll = this.selected - this.visible + 1;
		this.requestRender();
	}

	private clampSelection(): void {
		const count = this.ordered.length;
		this.selected = Math.min(Math.max(0, this.selected), Math.max(0, count - 1));
		this.listScroll = Math.min(Math.max(0, this.listScroll), Math.max(0, count - this.visible));
	}

	private openLogs(): void {
		const job = this.ordered[this.selected];
		if (!job) return;
		this.mode = "logs";
		this.logScroll = 0;
		this.follow = true;
		this.logLines = [];
		this.logTitle = `${job.id} ${shortLabel(job)}`;
		const result = this.callbacks.logs(job.id);
		if (result) this.setLogs(this.logTitle, result.lines);
		else this.requestRender();
	}

	handleInput(data: string): void {
		if (this.mode === "list") this.handleListInput(data);
		else this.handleLogInput(data);
	}

	/** Wheel scrolling moves the selection, or scrolls the log pane in log mode. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel" || !event.wheelDelta) return undefined;
		if (this.mode === "list") this.setSelection(this.selected + event.wheelDelta);
		else this.setLogScroll(this.logScroll + event.wheelDelta);
		return { handled: true };
	}

	private handleListInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data === "q") {
			this.onClose();
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") this.setSelection(this.selected - 1);
		else if (matchesKey(data, Key.down) || data === "j") this.setSelection(this.selected + 1);
		else if (matchesKey(data, Key.pageUp)) this.setSelection(this.selected - this.visible);
		else if (matchesKey(data, Key.pageDown)) this.setSelection(this.selected + this.visible);
		else if (matchesKey(data, Key.home)) this.setSelection(0);
		else if (matchesKey(data, Key.end)) this.setSelection(this.ordered.length - 1);
		else if (matchesKey(data, Key.enter) || data === "l") this.openLogs();
		else if (data === "d" || data === "K") {
			const job = this.ordered[this.selected];
			if (job && job.status === "running") {
				this.callbacks.kill(job.id);
				this.requestRender();
			}
		} else if (data === "x") {
			this.callbacks.clear();
			this.clampSelection();
			this.requestRender();
		}
	}

	private setLogScroll(next: number): void {
		this.logScroll = Math.min(Math.max(0, next), this.maxLogScroll);
		// Follow the tail only while the view is parked at the bottom.
		this.follow = this.logScroll >= this.maxLogScroll;
		this.requestRender();
	}

	private handleLogInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.backspace) || data === "q") {
			this.mode = "list";
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") this.setLogScroll(this.logScroll - 1);
		else if (matchesKey(data, Key.down) || data === "j") this.setLogScroll(this.logScroll + 1);
		else if (matchesKey(data, Key.pageUp)) this.setLogScroll(this.logScroll - this.visible);
		else if (matchesKey(data, Key.pageDown)) this.setLogScroll(this.logScroll + this.visible);
		else if (matchesKey(data, Key.home) || data === "g") this.setLogScroll(0);
		else if (matchesKey(data, Key.end) || data === "G") this.setLogScroll(this.maxLogScroll);
	}

	private summary(counts: JobCounts, width: number): string {
		const sep = this.theme.fg("muted", " · ");
		let text = this.theme.fg("muted", `${counts.total} job${counts.total === 1 ? "" : "s"}`);
		if (counts.running > 0) text += sep + this.theme.fg("muted", `${counts.running} running`);
		if (counts.failed > 0) text += sep + this.theme.fg("error", `${counts.failed} failed`);
		return truncateToWidth(`  ${text}`, width);
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		return this.mode === "logs" ? this.renderLogs(w) : this.renderList(w);
	}

	private renderList(w: number): string[] {
		const jobs = this.ordered;
		this.clampSelection();
		const focused = jobs[this.selected];
		const detail = focused ? formatJobDetail(focused, Date.now()) : [];
		// header, summary, blank, blank-after-list, blank-after-detail, hint, blank
		const chrome = 7 + detail.length;
		this.visible = this.fitRows(jobs.length, chrome);
		this.clampSelection();

		const lines: string[] = [screenHeader(this.theme, w, "Jobs"), this.summary(jobCounts(jobs), w), ""];
		if (jobs.length === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No background jobs.")}`, w));
		} else {
			const end = Math.min(jobs.length, this.listScroll + this.visible);
			for (let i = this.listScroll; i < end; i++) {
				lines.push(jobRow(jobs[i], this.theme, w, i === this.selected));
			}
			if (this.listScroll > 0 || end < jobs.length) {
				lines.push(
					truncateToWidth(
						this.theme.fg("dim", `  showing ${this.listScroll + 1}–${end} of ${jobs.length}`),
						w,
					),
				);
			}
		}
		lines.push("");
		for (const line of detail) lines.push(truncateToWidth(`  ${this.theme.fg("muted", line)}`, w));
		lines.push("");
		lines.push(screenHint(this.theme, w, ["↑/↓ select", "Enter logs", "d kill", "x clear finished", "Esc close"]));
		lines.push("");
		return lines;
	}

	private renderLogs(w: number): string[] {
		// header, blank, blank-after-log, hint, blank
		const chrome = 5;
		this.visible = this.fitRows(this.logLines.length, chrome);
		this.logScroll = Math.min(Math.max(0, this.logScroll), this.maxLogScroll);
		if (this.follow) this.logScroll = this.maxLogScroll;

		const label = this.logTitle ? `Job Logs · ${this.logTitle}` : "Job Logs";
		const lines: string[] = [screenHeader(this.theme, w, label), ""];
		if (this.logLines.length === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No output yet.")}`, w));
		} else {
			const end = Math.min(this.logLines.length, this.logScroll + this.visible);
			for (let i = this.logScroll; i < end; i++) {
				lines.push(truncateToWidth(`  ${this.logLines[i]}`, w));
			}
			if (this.logScroll > 0 || end < this.logLines.length) {
				lines.push(
					truncateToWidth(
						this.theme.fg("dim", `  line ${this.logScroll + 1}–${end} of ${this.logLines.length}`),
						w,
					),
				);
			}
		}
		lines.push("");
		lines.push(screenHint(this.theme, w, ["↑/↓ scroll", "g/G", "PgUp/PgDn", "Esc back"]));
		lines.push("");
		return lines;
	}
}

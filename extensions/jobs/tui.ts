/**
 * Terminal rendering for jobs.
 *
 * `JobsWidget` is the persistent, non-interactive list shown above the editor
 * while jobs run; `JobListComponent` is the dismissible `/jobs` screen with a
 * detail/log pane. Both are stateless with respect to time: elapsed values are
 * computed from `Date.now()` at render, so the runtime only has to call
 * `requestRender()`, never rebuild the component.
 *
 * Every line is clipped with `truncateToWidth`; log text arrives already
 * sanitized by the runtime, so no untrusted escape sequence reaches the
 * terminal through here.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { compareJobs, elapsedMs, formatDuration, shortLabel, statusGlyph } from "./format.ts";
import type { JobRecord } from "./types.ts";

/** Widget key used with `ctx.ui.setWidget()`. */
export const WIDGET_KEY = "jobs-widget";

/** Widget rows, including the header and any overflow line. */
const WIDGET_ROWS = 4;

/** Rows the `/jobs` screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ROWS = 14;
const SCREEN_MIN_ROWS = 4;
const SCREEN_MAX_ROWS = 24;
/** Fixed chrome rows around the list/log body. */
const SCREEN_CHROME_ROWS = 8;

function visibleRows(rows: number | undefined): number {
	if (rows === undefined || !Number.isFinite(rows) || rows <= 0) return SCREEN_DEFAULT_ROWS;
	return Math.max(SCREEN_MIN_ROWS, Math.min(rows - SCREEN_CHROME_ROWS, SCREEN_MAX_ROWS));
}

/** One row for a job: status glyph, label, elapsed. */
function jobRow(job: JobRecord, theme: Theme, width: number, selected = false): string {
	const elapsed = formatDuration(elapsedMs(job, Date.now()));
	const marker = selected ? theme.fg("accent", "›") : " ";
	const head = `${marker} ${statusGlyph(job.status, theme)} ${job.id}`;
	const tail = theme.fg("dim", elapsed);
	const label = shortLabel(job);
	const prefixWidth = 2 + 2 + job.id.length + 1;
	const available = Math.max(1, width - prefixWidth - elapsed.length - 2);
	const clipped = truncateToWidth(label, available);
	return truncateToWidth(`${head} ${clipped}  ${tail}`, width);
}

/** Persistent widget shown while any job is running. */
export class JobsWidget implements Component {
	constructor(
		private readonly jobs: () => Iterable<JobRecord>,
		private readonly theme: Theme,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const all = [...this.jobs()];
		const running = all.filter((job) => job.status === "running").sort(compareJobs);
		if (running.length === 0) return [];

		const hasMore = running.length > WIDGET_ROWS - 1;
		const shown = running.slice(0, hasMore ? WIDGET_ROWS - 2 : WIDGET_ROWS - 1);
		const lines = [`${this.theme.fg("accent", "Jobs")} ${this.theme.fg("dim", `${running.length} running`)}`];
		for (const job of shown) lines.push(jobRow(job, this.theme, w));
		if (hasMore) {
			lines.push(truncateToWidth(this.theme.fg("dim", `  … ${running.length - shown.length} more`), w));
		}
		return lines.map((line) => truncateToWidth(line, w));
	}
}

export interface JobListCallbacks {
	/** Current sanitized log text for a job, or undefined when unknown. */
	logs(id: string): { text: string } | undefined;
	kill(id: string): void;
	clear(): void;
}

/** Dismissible, scrollable `/jobs` screen. */
export class JobListComponent implements Component {
	private mode: "list" | "logs" = "list";
	private selected = 0;
	private listScroll = 0;
	private logScroll = 0;
	private logLines: string[] = [];
	private logTitle = "";
	private follow = true;
	private readonly visible: number;

	constructor(
		private readonly jobs: () => JobRecord[],
		private readonly theme: Theme,
		private readonly callbacks: JobListCallbacks,
		private readonly onClose: () => void,
		private readonly requestRender: () => void,
		viewportRows?: number,
	) {
		this.visible = visibleRows(viewportRows);
	}

	invalidate(): void {}

	/** Replace the log pane contents (called by the command's poll loop). */
	setLogs(title: string, text: string): void {
		this.logTitle = title;
		this.logLines = text.split("\n");
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
		if (result) this.setLogs(this.logTitle, result.text);
	}

	private get ordered(): JobRecord[] {
		return [...this.jobs()].sort(compareJobs);
	}

	private get maxLogScroll(): number {
		return Math.max(0, this.logLines.length - this.visible);
	}

	private clampSelection(): void {
		const count = this.ordered.length;
		this.selected = Math.min(Math.max(0, this.selected), Math.max(0, count - 1));
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
		if (result) this.setLogs(this.logTitle, result.text);
		else this.requestRender();
	}

	handleInput(data: string): void {
		if (this.mode === "list") this.handleListInput(data);
		else this.handleLogInput(data);
	}

	private handleListInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data === "q") {
			this.onClose();
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			this.selected--;
			this.clampSelection();
			if (this.selected < this.listScroll) this.listScroll = this.selected;
			this.requestRender();
		} else if (matchesKey(data, Key.down) || data === "j") {
			this.selected++;
			this.clampSelection();
			if (this.selected >= this.listScroll + this.visible) this.listScroll = this.selected - this.visible + 1;
			this.requestRender();
		} else if (matchesKey(data, Key.enter) || data === "l") {
			this.openLogs();
		} else if (data === "d" || data === "K") {
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

	private handleLogInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.backspace) || data === "q") {
			this.mode = "list";
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") this.logScroll--;
		else if (matchesKey(data, Key.down) || data === "j") this.logScroll++;
		else if (matchesKey(data, Key.pageUp)) this.logScroll -= this.visible;
		else if (matchesKey(data, Key.pageDown)) this.logScroll += this.visible;
		else if (data === "g") this.logScroll = 0;
		else if (data === "G") this.logScroll = this.maxLogScroll;
		this.logScroll = Math.min(Math.max(0, this.logScroll), this.maxLogScroll);
		// Follow the tail only while the view is parked at the bottom.
		this.follow = this.logScroll >= this.maxLogScroll;
		this.requestRender();
	}

	private header(width: number): string {
		const label = " Jobs ";
		const prefix = "───";
		if (width < 8) return this.theme.fg("borderMuted", "─".repeat(width));
		const remaining = width - prefix.length - label.length;
		return (
			this.theme.fg("borderMuted", prefix) +
			this.theme.fg("accent", label) +
			this.theme.fg("borderMuted", "─".repeat(Math.max(0, remaining)))
		);
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const lines: string[] = [this.header(w), ""];
		if (this.mode === "logs") this.renderLogs(lines, w);
		else this.renderList(lines, w);
		lines.push("");
		lines.push(truncateToWidth(`  ${this.theme.fg("dim", this.hint())}`, w));
		lines.push("");
		return lines;
	}

	private hint(): string {
		if (this.mode === "logs") return "↑/↓ scroll · g/G top/bottom · Esc back";
		return "↑/↓ select · Enter logs · d kill · x clear finished · Esc close";
	}

	private renderList(lines: string[], w: number): void {
		const jobs = this.ordered;
		if (jobs.length === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No background jobs.")}`, w));
			return;
		}
		const end = Math.min(jobs.length, this.listScroll + this.visible);
		for (let i = this.listScroll; i < end; i++) {
			lines.push(jobRow(jobs[i], this.theme, w, i === this.selected));
		}
		if (this.listScroll > 0 || end < jobs.length) {
			lines.push(
				truncateToWidth(this.theme.fg("dim", `  showing ${this.listScroll + 1}–${end} of ${jobs.length}`), w),
			);
		}
	}

	private renderLogs(lines: string[], w: number): void {
		lines.push(truncateToWidth(`  ${this.theme.fg("muted", this.logTitle)}`, w));
		lines.push("");
		if (this.logLines.length === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No output yet.")}`, w));
			return;
		}
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
}

/**
 * Terminal rendering for jobs' `/jobs` screen.
 *
 * `JobListComponent` is the dismissible `/jobs` screen with a focused detail
 * pane and a log view. It is stateless with respect to time: elapsed values are
 * computed from `Date.now()` at render, so the command can refresh the screen
 * without rebuilding the component.
 *
 * Every line is clipped with `truncateToWidth`; log text arrives already
 * sanitized by the runtime, so no untrusted escape sequence reaches the
 * terminal through here.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { screenHeader, screenHint, viewportRows, type ViewportRowsSource } from "../_shared/tui.ts";
import {
	compareJobs,
	elapsedMs,
	formatDuration,
	formatJobDetail,
	jobCounts,
	shortLabel,
	statusGlyph,
	type JobCounts,
} from "./format.ts";
import type { JobRecord } from "./types.ts";

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

export interface JobListCallbacks {
	/** Current sanitized log lines for a job, or undefined when unknown. */
	logs(id: string): { lines: string[] } | undefined;
	kill(id: string): void;
	clear(): void;
}

/** A destructive action waiting for y/N confirmation. */
type PendingConfirm = { kind: "kill"; id: string; label: string } | { kind: "clear"; count: number };

/** Dismissible `/jobs` screen: a selectable list with a focus pane and log view. */
export class JobListComponent implements Component {
	private mode: "list" | "logs" = "list";
	/** Stable selection identity; survives the live re-sort of the job list. */
	private selectedId: string | undefined;
	private listScroll = 0;
	/** Job whose log pane is open; captured so a re-sort cannot switch it. */
	private logJobId: string | undefined;
	private logScroll = 0;
	private logLines: string[] = [];
	private logTitle = "";
	private follow = true;
	/** Pending destructive action awaiting y/N. */
	private confirm: PendingConfirm | undefined;
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
		const titleChanged = title !== this.logTitle;
		const linesChanged = !this.sameLines(lines);
		this.logTitle = title;
		this.logLines = lines;
		if (this.follow) this.logScroll = this.maxLogScroll;
		else this.logScroll = Math.min(this.logScroll, this.maxLogScroll);
		// The poll fires every 500ms; skip the repaint when nothing changed so an
		// idle log pane does not redraw (and fight the user's scroll) constantly.
		if (titleChanged || linesChanged) this.requestRender();
	}

	private sameLines(next: string[]): boolean {
		if (next.length !== this.logLines.length) return false;
		for (let i = 0; i < next.length; i++) {
			if (next[i] !== this.logLines[i]) return false;
		}
		return true;
	}

	/** The job whose log pane is open, or undefined in list mode. */
	currentLogId(): string | undefined {
		return this.mode === "logs" ? this.logJobId : undefined;
	}

	/** Re-read the open log pane from the runtime. */
	refreshLogs(id: string): void {
		const result = this.callbacks.logs(id);
		if (result) this.setLogs(this.logTitle, result.lines);
	}

	private get ordered(): JobRecord[] {
		return [...this.jobs()].sort(compareJobs);
	}

	/** Index of the selected job in `ordered`, re-derived from its id each time. */
	private indexOfSelected(ordered: JobRecord[]): number {
		if (ordered.length === 0) return 0;
		const index = this.selectedId ? ordered.findIndex((job) => job.id === this.selectedId) : -1;
		return index >= 0 ? index : 0;
	}

	/** Scroll the list so `index` is visible. */
	private ensureVisible(index: number): void {
		if (index < this.listScroll) this.listScroll = index;
		else if (index >= this.listScroll + this.visible) this.listScroll = index - this.visible + 1;
		this.listScroll = Math.max(0, this.listScroll);
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
		const ordered = this.ordered;
		if (ordered.length === 0) return;
		const index = Math.min(Math.max(0, next), ordered.length - 1);
		this.selectedId = ordered[index].id;
		this.ensureVisible(index);
		this.requestRender();
	}

	private clampSelection(): void {
		const ordered = this.ordered;
		if (ordered.length === 0) {
			this.selectedId = undefined;
			this.listScroll = 0;
			return;
		}
		this.selectedId = ordered[this.indexOfSelected(ordered)].id;
		this.listScroll = Math.min(Math.max(0, this.listScroll), Math.max(0, ordered.length - this.visible));
	}

	private openLogs(): void {
		const job = this.ordered[this.indexOfSelected(this.ordered)];
		if (!job) return;
		this.mode = "logs";
		this.logJobId = job.id;
		this.logScroll = 0;
		this.follow = true;
		this.logLines = [];
		this.logTitle = `${job.id} ${shortLabel(job)}`;
		const result = this.callbacks.logs(job.id);
		if (result) this.setLogs(this.logTitle, result.lines);
		else this.requestRender();
	}

	handleInput(data: string): void {
		if (this.confirm) {
			this.handleConfirmInput(data);
			return;
		}
		if (this.mode === "list") this.handleListInput(data);
		else this.handleLogInput(data);
	}

	/** Wheel scrolling moves the selection, or scrolls the log pane in log mode. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel" || !event.wheelDelta) return undefined;
		if (this.confirm) return { handled: true };
		if (this.mode === "list") {
			this.setSelection(this.indexOfSelected(this.ordered) + event.wheelDelta);
		} else {
			this.setLogScroll(this.logScroll + event.wheelDelta);
		}
		return { handled: true };
	}

	private handleListInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data === "q") {
			this.onClose();
			return;
		}
		const ordered = this.ordered;
		const index = this.indexOfSelected(ordered);
		if (matchesKey(data, Key.up) || data === "k") this.setSelection(index - 1);
		else if (matchesKey(data, Key.down) || data === "j") this.setSelection(index + 1);
		else if (matchesKey(data, Key.pageUp)) this.setSelection(index - this.visible);
		else if (matchesKey(data, Key.pageDown)) this.setSelection(index + this.visible);
		else if (matchesKey(data, Key.home)) this.setSelection(0);
		else if (matchesKey(data, Key.end)) this.setSelection(ordered.length - 1);
		else if (matchesKey(data, Key.enter) || data === "l") this.openLogs();
		else if (data === "d" || data === "K") {
			const job = ordered[index];
			if (job && job.status === "running") {
				this.confirm = { kind: "kill", id: job.id, label: shortLabel(job) };
				this.requestRender();
			}
		} else if (data === "x") {
			const count = ordered.filter((job) => job.status !== "running").length;
			if (count > 0) {
				this.confirm = { kind: "clear", count };
				this.requestRender();
			}
		}
	}

	/** Resolve a pending y/N confirmation. */
	private handleConfirmInput(data: string): void {
		const pending = this.confirm;
		if (!pending) return;
		if (data === "y" || data === "Y" || matchesKey(data, Key.enter)) {
			this.confirm = undefined;
			if (pending.kind === "kill") this.callbacks.kill(pending.id);
			else {
				this.callbacks.clear();
				this.clampSelection();
			}
			this.requestRender();
			return;
		}
		if (
			data === "n" ||
			data === "N" ||
			matchesKey(data, Key.escape) ||
			matchesKey(data, Key.ctrl("c")) ||
			data === "q"
		) {
			this.confirm = undefined;
			this.requestRender();
		}
	}

	/** Warning line shown in place of the hint while a confirm is pending. */
	private confirmPrompt(): string {
		const pending = this.confirm;
		if (!pending) return "";
		return pending.kind === "kill"
			? `Kill ${pending.id} (${pending.label})? y/N`
			: `Clear ${pending.count} finished job${pending.count === 1 ? "" : "s"}? y/N`;
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
			this.logJobId = undefined;
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
		const index = this.indexOfSelected(jobs);
		const focused = jobs[index];
		const detail = focused ? formatJobDetail(focused, Date.now()) : [];
		// header, summary, blank, blank-after-list, blank-after-detail, hint, blank
		const chrome = 7 + detail.length;
		this.visible = this.fitRows(jobs.length, chrome);
		this.clampSelection();
		this.ensureVisible(this.indexOfSelected(jobs));

		const lines: string[] = [screenHeader(this.theme, w, "Jobs"), this.summary(jobCounts(jobs), w), ""];
		if (jobs.length === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No background jobs.")}`, w));
		} else {
			const end = Math.min(jobs.length, this.listScroll + this.visible);
			for (let i = this.listScroll; i < end; i++) {
				lines.push(jobRow(jobs[i], this.theme, w, i === index));
			}
			if (this.listScroll > 0 || end < jobs.length) {
				lines.push(
					truncateToWidth(this.theme.fg("dim", `  showing ${this.listScroll + 1}–${end} of ${jobs.length}`), w),
				);
			}
		}
		lines.push("");
		for (const line of detail) lines.push(truncateToWidth(`  ${this.theme.fg("muted", line)}`, w));
		lines.push("");
		lines.push(
			this.confirm
				? truncateToWidth(`  ${this.theme.fg("warning", this.confirmPrompt())}`, w)
				: screenHint(this.theme, w, ["↑/↓ select", "Enter logs", "d kill", "x clear finished", "Esc close"]),
		);
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
					truncateToWidth(this.theme.fg("dim", `  line ${this.logScroll + 1}–${end} of ${this.logLines.length}`), w),
				);
			}
		}
		lines.push("");
		lines.push(screenHint(this.theme, w, ["↑/↓ scroll", "g/G", "PgUp/PgDn", "Esc back"]));
		lines.push("");
		return lines;
	}
}

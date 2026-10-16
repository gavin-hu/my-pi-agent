/**
 * Terminal rendering for jobs' `/jobs` screen.
 *
 * `JobListComponent` is the dismissible `/jobs` screen with a focused detail
 * pane and a log view. It is stateless with respect to time: elapsed values are
 * computed from `Date.now()` at render, so the command can refresh the screen
 * without rebuilding the component.
 *
 * The screen is drawn from the design system: a label-first `titleRule`, one
 * `listRow` grammar, `emptyState`, and the shared `IdCursor` (a live job list is
 * re-sorted under the focus) and `LinePane` (the log tail).
 *
 * Log text arrives already sanitized by the runtime, so no untrusted escape
 * sequence reaches the terminal through here.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { dockListFrame, screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip, fitCells } from "../../lib/tui/columns.ts";
import { fitRows, formatRange, IdCursor, isCloseKey, navIntent, wheelDelta } from "../../lib/tui/cursor.ts";
import { expandHint, SEPARATORS } from "../../lib/tui/glyphs.ts";
import { LinePane } from "../../lib/tui/line-pane.ts";
import { emptyState, listRow } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint } from "../../lib/tui/tokens.ts";
import {
	compareJobs,
	elapsedMs,
	formatDuration,
	formatJobDetail,
	jobCounts,
	sanitizeLogLine,
	shortLabel,
	statusGlyphChar,
	statusRole,
	type JobCounts,
} from "./format.ts";
import type { JobRecord } from "./types.ts";

/** Rows the `/jobs` screen body shows when the terminal height is unknown. */
const SCREEN_DEFAULT_ROWS = 14;

/** Fixed rows around the list body: header, summary, blank, blank, hint, blank. */
const LIST_CHROME_ROWS = 7;

/** Fixed rows around the log body: header, subtitle, blank, blank, hint, blank. */
const LOG_CHROME_ROWS = 6;

/** A job's stable identity, for the id-anchored cursor. */
const jobId = (job: JobRecord): string => job.id;

/** One job row: selection marker, status glyph, id, label, and a right-aligned
 *  elapsed value. `listRow` owns the clipping and the alignment. */
function jobRow(job: JobRecord, theme: Theme, width: number, selected = false): string {
	return listRow(theme, width, {
		selected,
		glyph: statusGlyphChar(job.status),
		glyphRole: statusRole(job.status),
		label: `${job.id}  ${shortLabel(job)}`,
		trailing: formatDuration(elapsedMs(job, Date.now())),
		trailingRole: "faint",
	});
}

/** Input for the transcript result: a themed job list or a log tail. */
export type JobResultInput =
	| { kind: "list"; jobs: JobRecord[]; more: number }
	| { kind: "logs"; lines: string[]; earlier: number };

/**
 * Transcript result block for the `job` tool: a blank line, then either the
 * `/jobs`-style row rail (already ordered and capped by the caller) or the
 * themed log tail. Reused across renders via `setInput`.
 */
export class JobResult implements Component {
	private input: JobResultInput;
	private theme: Theme;

	constructor(input: JobResultInput, theme: Theme) {
		this.input = input;
		this.theme = theme;
	}

	/** Update in place so the transcript can reuse this component across renders. */
	setInput(input: JobResultInput, theme: Theme): void {
		this.input = input;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		// A leading blank line separates the result from the call header.
		const lines: string[] = [""];
		if (this.input.kind === "list") {
			for (const job of this.input.jobs) lines.push(jobRow(job, this.theme, w));
			if (this.input.more > 0) {
				const note = `${paint(this.theme, "faint", `… ${this.input.more} more`)} ${expandHint(this.theme)}`;
				lines.push(clip(`  ${note}`, w));
			}
		} else {
			if (this.input.earlier > 0) {
				const note = `${paint(this.theme, "faint", `… ${this.input.earlier} earlier lines`)} ${expandHint(this.theme)}`;
				lines.push(clip(note, w));
			}
			for (const line of this.input.lines) {
				lines.push(this.theme.fg("toolOutput", clip(line, w)));
			}
		}
		return lines;
	}
}

export interface JobListCallbacks {
	/** Current sanitized log lines for a job, or undefined when unknown. */
	logs(id: string): { lines: string[]; more?: boolean } | undefined;
	kill(id: string): void;
	clear(): void;
}

/** A destructive action waiting for y/N confirmation. */
type PendingConfirm =
	| { kind: "kill"; id: string; label: string }
	| { kind: "clear"; count: number; unreported: number };

/** Dismissible `/jobs` screen: a selectable list with a focus pane and log view. */
export class JobListComponent implements Component {
	private mode: "list" | "logs" = "list";
	/** Focus anchored to a job id; the list is re-sorted from live state each render. */
	private readonly cursor = new IdCursor();
	/** The open log tail. */
	private readonly pane = new LinePane();
	/** Pending destructive action awaiting y/N. */
	private confirm: PendingConfirm | undefined;
	/** Transient feedback shown in place of the hint, e.g. a no-op action. */
	private notice: string | undefined;

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
	setLogs(title: string, lines: string[], meta: { more?: boolean; logPath?: string } = {}): void {
		// The poll fires every 500ms; `LinePane.update` skips the repaint when
		// nothing changed so an idle log pane does not redraw (and fight the
		// user's scroll) constantly.
		if (this.pane.update({ title, lines, more: meta.more, subtitle: meta.logPath })) this.requestRender();
	}

	/** The job whose log pane is open, or undefined in list mode. */
	currentLogId(): string | undefined {
		return this.mode === "logs" && this.pane.id ? this.pane.id : undefined;
	}

	/** Re-read the open log pane from the runtime. */
	refreshLogs(id: string): void {
		const result = this.callbacks.logs(id);
		if (result && this.pane.update({ lines: result.lines, more: result.more })) this.requestRender();
	}

	private get ordered(): JobRecord[] {
		return [...this.jobs()].sort(compareJobs);
	}

	/** Focus job `next` (clamped) and keep it visible. */
	private select(next: number): void {
		const jobs = this.ordered;
		if (jobs.length === 0) return;
		this.cursor.select(jobs, jobId, next);
		this.requestRender();
	}

	private openLogs(): void {
		const job = this.ordered[this.cursor.indexOf(this.ordered, jobId)];
		if (!job) return;
		this.mode = "logs";
		const result = this.callbacks.logs(job.id);
		this.pane.open(job.id, {
			title: `${job.id} ${shortLabel(job)}`,
			lines: result?.lines ?? [],
			more: result?.more ?? false,
			subtitle: job.logPath ? sanitizeLogLine(job.logPath) : undefined,
		});
		this.requestRender();
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
		const delta = wheelDelta(event);
		if (delta === undefined) return undefined;
		if (this.confirm) return { handled: true };
		if (this.mode === "list") {
			this.select(this.cursor.indexOf(this.ordered, jobId) + delta);
		} else {
			this.pane.setScroll(this.pane.scroll + delta);
			this.requestRender();
		}
		return { handled: true };
	}

	private handleListInput(data: string): void {
		if (isCloseKey(data) || data === "q") {
			this.onClose();
			return;
		}
		// Any other key dismisses a prior notice, so it does not linger.
		if (this.notice !== undefined) {
			this.notice = undefined;
			this.requestRender();
		}
		const ordered = this.ordered;
		const index = this.cursor.indexOf(ordered, jobId);
		switch (navIntent(data)) {
			case "up":
				this.select(index - 1);
				return;
			case "down":
				this.select(index + 1);
				return;
			case "pageUp":
				this.select(index - this.cursor.visible);
				return;
			case "pageDown":
				this.select(index + this.cursor.visible);
				return;
			case "home":
				this.select(0);
				return;
			case "end":
				this.select(ordered.length - 1);
				return;
		}
		if (matchesKey(data, Key.enter) || data === "l") this.openLogs();
		else if (data === "d" || data === "K") {
			const job = ordered[index];
			if (!job) return;
			if (job.status === "running") {
				this.confirm = { kind: "kill", id: job.id, label: shortLabel(job) };
			} else {
				// A finished job has nothing to kill; say so instead of a silent no-op.
				this.notice = `${job.id} already ${job.status}; nothing to kill.`;
			}
			this.requestRender();
		} else if (data === "x") {
			const finished = ordered.filter((job) => job.status !== "running");
			if (finished.length > 0) {
				this.confirm = {
					kind: "clear",
					count: finished.length,
					unreported: finished.filter((job) => !job.seen).length,
				};
			} else {
				this.notice = "No finished jobs to clear.";
			}
			this.requestRender();
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
				this.cursor.clamp(this.ordered, jobId);
			}
			this.requestRender();
			return;
		}
		if (data === "n" || data === "N" || isCloseKey(data) || data === "q") {
			this.confirm = undefined;
			this.requestRender();
		}
	}

	/** Warning line shown in place of the hint while a confirm is pending. */
	private confirmPrompt(): string {
		const pending = this.confirm;
		if (!pending) return "";
		if (pending.kind === "kill") return `Kill ${pending.id} (${pending.label})? y/N`;
		const note =
			pending.unreported > 0
				? ` ${pending.unreported} unreported result${pending.unreported === 1 ? "" : "s"} will be discarded.`
				: "";
		return `Clear ${pending.count} finished job${pending.count === 1 ? "" : "s"}?${note} y/N`;
	}

	private handleLogInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.backspace) || data === "q") {
			this.mode = "list";
			this.pane.close();
			this.requestRender();
			return;
		}
		if (this.pane.handleKey(data)) this.requestRender();
	}

	private summary(counts: JobCounts, width: number): string {
		const cells = [paint(this.theme, "meta", `${counts.total} job${counts.total === 1 ? "" : "s"}`)];
		if (counts.running > 0) cells.push(paint(this.theme, "meta", `${counts.running} running`));
		if (counts.failed > 0) cells.push(paint(this.theme, "bad", `${counts.failed} failed`));
		const separator = paint(this.theme, "meta", SEPARATORS.item);
		return clip(`  ${fitCells(cells, Math.max(1, width - 2), separator)}`, width);
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		return this.mode === "logs" ? this.renderLogs(w) : this.renderList(w);
	}

	private renderList(w: number): string[] {
		const jobs = this.ordered;
		this.cursor.clamp(jobs, jobId);
		const index = this.cursor.indexOf(jobs, jobId);
		const focused = jobs[index];
		const detail = focused ? formatJobDetail(focused, Date.now()) : [];
		this.cursor.visible = fitRows(
			this.viewportRowsSource,
			jobs.length,
			LIST_CHROME_ROWS + detail.length,
			SCREEN_DEFAULT_ROWS,
		);
		this.cursor.clamp(jobs, jobId);
		this.cursor.ensureVisible(this.cursor.indexOf(jobs, jobId));

		const body: string[] = [];
		let range: string | undefined;
		if (jobs.length === 0) {
			body.push(...emptyState(this.theme, w, { label: "No background jobs." }));
		} else {
			const end = Math.min(jobs.length, this.cursor.scroll + this.cursor.visible);
			for (let i = this.cursor.scroll; i < end; i++) body.push(jobRow(jobs[i], this.theme, w, i === index));
			if (this.cursor.scroll > 0 || end < jobs.length) {
				range = formatRange(this.theme, w, { start: this.cursor.scroll, end, total: jobs.length });
			}
		}

		const hint = this.confirm
			? clip(`  ${paint(this.theme, "warn", this.confirmPrompt())}`, w)
			: this.notice
				? clip(`  ${paint(this.theme, "meta", this.notice)}`, w)
				: screenHint(this.theme, w, [
						"Esc close",
						"↑/↓ or j/k select",
						"Enter or l logs",
						"d or K kill",
						"x clear finished",
						"PgUp/PgDn",
					]);

		return dockListFrame({
			header: titleRule(this.theme, w, "Jobs"),
			summary: this.summary(jobCounts(jobs), w),
			body,
			range,
			// The detail pane is separated from the list by a blank line.
			detail: ["", ...detail.map((line) => clip(`  ${paint(this.theme, "meta", line)}`, w))],
			hint,
		});
	}

	private renderLogs(w: number): string[] {
		const visible = fitRows(this.viewportRowsSource, this.pane.count, LOG_CHROME_ROWS, SCREEN_DEFAULT_ROWS);
		this.pane.fit(visible);

		const body: string[] = [];
		let range: string | undefined;
		if (this.pane.count === 0) {
			body.push(...emptyState(this.theme, w, { label: "No output yet." }));
		} else {
			const { start, end } = this.pane.window();
			for (let i = start; i < end; i++) body.push(clip(`  ${this.pane.lines[i]}`, w));
			if (start > 0 || end < this.pane.count) {
				range = formatRange(this.theme, w, { start, end, total: this.pane.count, label: "line" });
			}
		}

		return dockListFrame({
			header: titleRule(this.theme, w, this.pane.title("Job Logs")),
			summary: clip(`  ${paint(this.theme, "faint", this.pane.subtitleLine())}`, w),
			body,
			range,
			hint: screenHint(this.theme, w, ["Esc back", "↑/↓ scroll", "g/G ends", "PgUp/PgDn"]),
		});
	}
}

/**
 * Terminal rendering for jobs' `/jobs` screen.
 *
 * `JobListComponent` is the dismissible `/jobs` screen with a focused detail
 * pane and a log view. It is stateless with respect to time: elapsed values are
 * computed from `Date.now()` at render, so the command can refresh the screen
 * without rebuilding the component.
 *
 * The frame, the navigation keys, the y/N confirmation, and the log pane come
 * from the shared `DockListScreen`, so this module owns only the job vocabulary:
 * the row, the focus block, the counts, the hints, and what the verbs do.
 *
 * Log text arrives already sanitized by the runtime, so no untrusted escape
 * sequence reaches the terminal through here.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { formatDuration, sanitizeUntrustedLine } from "../../lib/format.ts";
import type { ScreenHint, ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { DockListScreen, type DetailContents } from "../../lib/tui/dock-screen.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { statusRow, type StatusRow } from "../../lib/tui/rows.ts";
import { TailResult, type TailResultInput } from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import {
	compareJobs,
	elapsedMs,
	formatJobDetail,
	jobCounts,
	shortLabel,
	statusGlyphChar,
	statusRole,
	type JobCounts,
} from "./format.ts";
import type { JobRecord } from "./types.ts";

/** One job row: selection marker, status glyph, id, label, and a right-aligned
 *  elapsed value, tagged `peer` when another session owns it. `statusRow` owns
 *  the clipping and the alignment. */
function jobRow(
	job: JobRecord,
	theme: Theme,
	width: number,
	options: Pick<StatusRow, "selected" | "marker"> & { foreign?: boolean } = {},
): string {
	const elapsed = formatDuration(elapsedMs(job, Date.now()));
	return statusRow(theme, width, {
		...options,
		glyph: statusGlyphChar(job.status),
		glyphRole: statusRole(job.status),
		label: `${job.id}  ${shortLabel(job)}`,
		labelRole: options.selected ? "accent" : "label",
		// The tag rides the right-aligned cell, which survives a narrow terminal.
		trailing: options.foreign ? `${elapsed}${SEPARATORS.item}peer` : elapsed,
	});
}

/** Input for the transcript result: a themed job list or a log tail. */
export type JobResultInput =
	| { kind: "list"; jobs: JobRecord[]; more: number; sessionId?: string }
	| { kind: "logs"; lines: string[]; earlier: number };

/** Map the job vocabulary onto the shared transcript tail block. */
function jobTail(input: JobResultInput): TailResultInput<JobRecord> {
	if (input.kind === "logs") {
		return { kind: "lines", lines: input.lines, earlier: input.earlier, earlierLabel: "lines" };
	}
	return {
		kind: "list",
		rows: input.jobs,
		more: input.more,
		rowLine: (job, width, theme) => {
			const foreign = input.sessionId !== undefined && job.sessionId !== input.sessionId;
			return jobRow(job, theme, width, { marker: false, foreign });
		},
	};
}

/**
 * Transcript result block for the `job` tool: the shared tail block over the
 * `/jobs`-style row rail or the themed log tail. Reused across renders.
 */
export class JobResult implements Component {
	private readonly view: TailResult<JobRecord>;

	constructor(input: JobResultInput, theme: Theme) {
		this.view = new TailResult(jobTail(input), theme);
	}

	/** Update in place so the transcript can reuse this component across renders. */
	setInput(input: JobResultInput, theme: Theme): void {
		this.view.setInput(jobTail(input), theme);
	}

	invalidate(): void {
		this.view.invalidate();
	}

	render(width: number): string[] {
		return this.view.render(width);
	}
}

export interface JobListCallbacks {
	/** This session's id: a record with another id belongs to a peer session. */
	sessionId(): string;
	/** Current sanitized log lines for a job, or undefined when unknown. */
	logs(id: string): { lines: string[]; more?: boolean } | undefined;
	kill(id: string): void;
	clear(): void;
}

/** Dismissible `/jobs` screen: a selectable list with a focus pane and log view. */
export class JobListComponent extends DockListScreen<JobRecord> {
	constructor(
		private readonly jobs: () => JobRecord[],
		theme: Theme,
		private readonly callbacks: JobListCallbacks,
		onClose: () => void,
		requestRender: () => void,
		viewportRowsSource?: ViewportRowsSource,
	) {
		super({
			theme,
			title: "Jobs",
			detailTitle: "Job Logs",
			emptyList: "No background jobs.",
			emptyDetail: "No output yet.",
			requestRender,
			onClose,
			viewportRowsSource,
		});
	}

	/** Replace the log pane contents (called by the command's poll loop). */
	setLogs(title: string, lines: string[], meta: { more?: boolean; logPath?: string } = {}): void {
		// The poll fires every 500ms; `LinePane.update` skips the repaint when
		// nothing changed so an idle log pane does not redraw (and fight the
		// user's scroll) constantly.
		this.setDetail({ title, lines, more: meta.more, subtitle: meta.logPath });
	}

	/** The job whose log pane is open, or undefined in list mode. */
	currentLogId(): string | undefined {
		return this.currentDetailId();
	}

	/** Re-read the open log pane from the runtime. */
	refreshLogs(id: string): void {
		this.refreshDetail(id);
	}

	/** Whether another session owns this job, so the screen leaves it alone. */
	private isForeign(job: JobRecord): boolean {
		return job.sessionId !== this.callbacks.sessionId();
	}

	protected rows(): readonly JobRecord[] {
		return [...this.jobs()].sort(compareJobs);
	}

	protected idOf(job: JobRecord): string {
		return job.id;
	}

	protected rowLine(job: JobRecord, width: number, selected: boolean): string {
		return jobRow(job, this.theme, width, { selected, foreign: this.isForeign(job) });
	}

	protected detailBlock(job: JobRecord): string[] {
		return formatJobDetail(job, Date.now(), this.callbacks.sessionId());
	}

	protected summaryCells(rows: readonly JobRecord[]): string[] {
		const counts: JobCounts = jobCounts([...rows]);
		const cells = [paint(this.theme, "meta", `${counts.total} job${counts.total === 1 ? "" : "s"}`)];
		if (counts.running > 0) cells.push(paint(this.theme, "meta", `${counts.running} running`));
		if (counts.failed > 0) cells.push(paint(this.theme, "bad", `${counts.failed} failed`));
		const foreign = rows.filter((job) => this.isForeign(job)).length;
		if (foreign > 0) cells.push(paint(this.theme, "faint", `${foreign} peer`));
		return cells;
	}

	protected listHints(): ScreenHint[] {
		return [
			"Esc close",
			"↑/↓ or j/k select",
			{ text: "Enter or l logs", color: "accent" },
			{ text: "d or K kill", color: "warning" },
			{ text: "x clear finished", color: "warning" },
			"PgUp/PgDn",
		];
	}

	protected detailHints(): ScreenHint[] {
		return ["Esc back", "↑/↓ scroll", "g/G ends", "PgUp/PgDn"];
	}

	protected detailFor(job: JobRecord): DetailContents {
		const result = this.callbacks.logs(job.id);
		return {
			title: `${job.id} ${shortLabel(job)}`,
			lines: result?.lines ?? [],
			more: result?.more ?? false,
			subtitle: job.logPath ? sanitizeUntrustedLine(job.logPath) : undefined,
		};
	}

	protected detailById(id: string): { lines: string[]; more?: boolean } | undefined {
		return this.callbacks.logs(id);
	}

	protected handleVerb(key: string, job: JobRecord | undefined): void {
		if (key === "d" || key === "K") {
			if (!job) return;
			if (this.isForeign(job)) {
				// Another session's job is shown here, not managed from here.
				this.notify(`${job.id} is another session's job; not killed.`);
			} else if (job.status === "running") {
				this.confirm(`Kill ${job.id} (${shortLabel(job)})? y/N`, () => this.callbacks.kill(job.id));
			} else {
				// A finished job has nothing to kill; say so instead of a silent no-op.
				this.notify(`${job.id} already ${job.status}; nothing to kill.`);
			}
			return;
		}
		if (key !== "x") return;
		// Only this session's finished jobs are ours to clear, so the prompt and the
		// result agree.
		const finished = this.rows().filter((row) => !this.isForeign(row) && row.status !== "running");
		if (finished.length === 0) {
			this.notify("No finished jobs to clear.");
			return;
		}
		const unreported = finished.filter((row) => !row.seen).length;
		const note =
			unreported > 0 ? ` ${unreported} unreported result${unreported === 1 ? "" : "s"} will be discarded.` : "";
		this.confirm(`Clear ${finished.length} finished job${finished.length === 1 ? "" : "s"}?${note} y/N`, () =>
			this.callbacks.clear(),
		);
	}
}

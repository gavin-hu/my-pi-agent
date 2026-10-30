/**
 * The `/agents` board: background runs, live status, and a per-run detail.
 *
 * The board reads runs from a getter on every render, so a finish or cancel is
 * reflected without rebuilding the component. The frame, the id-anchored cursor,
 * the navigation and wheel keys, and the pane lifecycle come from the shared
 * `DockListScreen`, so this module owns only the run vocabulary: the row, the
 * status view, the key/value facts, the hints, and what `c` and `x` do.
 *
 * Two of that base's optional members are why the board can be one: the pane is
 * live (`liveDetail`), because a running child's output arrives between frames
 * and nothing polls it, and the facts are a `facts` hook, because the key/value
 * rows are built from the current width.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeLine, stripControlChars } from "../../../lib/format.ts";
import type { ScreenHint, ViewportRowsSource } from "../../../lib/tui/chrome.ts";
import { DockListScreen, type DetailContents } from "../../../lib/tui/dock-screen.ts";
import { GLYPHS, SEPARATORS } from "../../../lib/tui/glyphs.ts";
import { keyValueRow, statusRow } from "../../../lib/tui/rows.ts";
import { paint, type TuiRole } from "../../../lib/tui/tokens.ts";
import type { BackgroundRun, BackgroundStatus } from "../background.ts";
import { canCollect } from "../background.ts";
import { formatBackgroundDuration, formatUsageStats } from "../format.ts";

/** One status's glyph, role, and readable label. */
function statusView(status: BackgroundStatus): { glyph: string; role: TuiRole; label: string } {
	switch (status) {
		case "running":
			return { glyph: GLYPHS.jobsRunning, role: "warn", label: "running" };
		case "finished":
			return { glyph: GLYPHS.check, role: "ok", label: "finished" };
		case "failed":
			return { glyph: GLYPHS.jobsFailure, role: "bad", label: "failed" };
		case "cancelled":
			return { glyph: GLYPHS.stopped, role: "warn", label: "cancelled" };
		case "timedout":
			return { glyph: GLYPHS.warn, role: "bad", label: "timed out" };
		case "interrupted":
			return { glyph: GLYPHS.unknown, role: "faint", label: "interrupted" };
	}
}

/** A short task label for a list row. */
function taskLabel(run: BackgroundRun): string {
	return sanitizeLine(run.task).split("\n")[0] ?? "";
}

/** The output rows for the detail pane. */
function outputLines(run: BackgroundRun): string[] {
	const text =
		run.output?.trim() ||
		(run.status === "running"
			? "Still running…"
			: run.status === "interrupted"
				? "Interrupted before it finished."
				: "(no output recorded)");
	return text.split("\n").map((line) => stripControlChars(line).replaceAll("\t", "    ").slice(0, 2_000));
}

/** The detail key/value rows. */
function detailRows(run: BackgroundRun, now: number, theme: Theme, width: number): string[] {
	const usage = run.usage ? formatUsageStats(run.usage) : "(not reported)";
	const rows = [
		keyValueRow(theme, width, { label: "Task", value: taskLabel(run), labelWidth: 12 }),
		keyValueRow(theme, width, { label: "Cwd", value: sanitizeLine(run.cwd), labelWidth: 12 }),
		keyValueRow(theme, width, { label: "Status", value: statusView(run.status).label, labelWidth: 12 }),
		keyValueRow(theme, width, { label: "Duration", value: formatBackgroundDuration(run, now), labelWidth: 12 }),
		keyValueRow(theme, width, { label: "Usage", value: usage, labelWidth: 12 }),
	];
	if (run.errorMessage) {
		rows.push(keyValueRow(theme, width, { label: "Error", value: sanitizeLine(run.errorMessage), labelWidth: 12 }));
	}
	if (run.artifactPath) {
		rows.push(
			keyValueRow(theme, width, { label: "Transcript", value: sanitizeLine(run.artifactPath), labelWidth: 12 }),
		);
	}
	return rows;
}

export interface AgentsBoardOptions {
	runs: () => readonly BackgroundRun[];
	theme: Theme;
	now?: () => number;
	/** Collect a finished run; the command closes the board and sends it. */
	onCollect: (runId: string) => void;
	/** Cancel a running run; the board stays open. */
	onCancel: (runId: string) => void;
	onClose: () => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
}

/** The list/detail board for background subagent runs. */
export class AgentsBoardComponent extends DockListScreen<BackgroundRun> {
	constructor(private readonly board: AgentsBoardOptions) {
		super({
			theme: board.theme,
			title: "Agents",
			detailTitle: "Run",
			emptyList: "No background subagents yet.",
			emptyDetail: "(no output recorded)",
			requestRender: board.requestRender,
			onClose: board.onClose,
			viewportRowsSource: board.viewportRows,
		});
	}

	private get now(): number {
		return (this.board.now ?? Date.now)();
	}

	/** `c` collects a finished run and `x` cancels a running one, in either mode. */
	private act(key: string, run: BackgroundRun | undefined): boolean {
		if (!run) return false;
		if (key === "c" && canCollect(run)) {
			this.board.onCollect(run.id);
			return true;
		}
		if (key === "x" && run.status === "running") {
			this.board.onCancel(run.id);
			return true;
		}
		return false;
	}

	protected rows(): readonly BackgroundRun[] {
		return this.board.runs();
	}

	protected idOf(run: BackgroundRun): string {
		return run.id;
	}

	protected rowLine(run: BackgroundRun, width: number, selected: boolean): string {
		const view = statusView(run.status);
		const usage = run.usage ? formatUsageStats(run.usage) : "";
		const trailing = [view.label, formatBackgroundDuration(run, this.now), usage].filter(Boolean).join(SEPARATORS.item);
		return statusRow(this.theme, width, {
			selected,
			glyph: view.glyph,
			glyphRole: view.role,
			label: `${run.id} ${sanitizeLine(run.agent)}  ${taskLabel(run)}`,
			labelRole: selected ? "accent" : "label",
			trailing,
		});
	}

	/** The board has never carried a focus block: the detail pane states the facts. */
	protected detailBlock(): string[] {
		return [];
	}

	protected summaryCells(rows: readonly BackgroundRun[]): string[] {
		const running = rows.filter((run) => run.status === "running").length;
		const cells = [paint(this.theme, "meta", `${rows.length} run${rows.length === 1 ? "" : "s"}`)];
		if (running > 0) cells.push(paint(this.theme, "meta", `${running} running`));
		return cells;
	}

	protected listHints(): ScreenHint[] {
		const focused = this.focusedRow;
		const hints: ScreenHint[] = ["Esc close", { text: "Enter detail", color: "accent" }];
		if (focused && canCollect(focused)) hints.push({ text: "c collect", color: "accent" });
		if (focused?.status === "running") hints.push({ text: "x cancel", color: "warn" });
		hints.push("↑/↓ select");
		return hints;
	}

	protected detailHints(run: BackgroundRun | undefined): ScreenHint[] {
		const hints: ScreenHint[] = ["Esc back"];
		if (run && canCollect(run)) hints.push({ text: "c collect", color: "accent" });
		if (run?.status === "running") hints.push({ text: "x cancel", color: "warn" });
		hints.push("j/k scroll");
		return hints;
	}

	protected detailFor(run: BackgroundRun): DetailContents {
		return {
			title: `${run.id} ${sanitizeLine(run.agent)}`,
			subtitle: `${statusView(run.status).label}${SEPARATORS.item}${formatBackgroundDuration(run, this.now)}`,
			// The key/value rows need the current width, so they are rebuilt per frame.
			facts: (width) => detailRows(run, this.now, this.theme, width),
			lines: outputLines(run),
		};
	}

	/** The output a live run keeps producing; a removed run has none, which closes the pane. */
	protected detailById(id: string): { lines: string[] } | undefined {
		const run = this.rows().find((entry) => entry.id === id);
		return run ? { lines: outputLines(run) } : undefined;
	}

	/** Re-read the pane on every frame: a child's output arrives without a poll. */
	protected liveDetail(): boolean {
		return true;
	}

	protected handleVerb(key: string, focused: BackgroundRun | undefined): void {
		this.act(key, focused);
	}

	protected handleDetailVerb(key: string, run: BackgroundRun): boolean {
		return this.act(key, run);
	}
}

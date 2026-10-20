/**
 * The `/agents` board: background runs, live status, and a per-run detail.
 *
 * The board reads runs from a getter on every render, so a finish or cancel is
 * reflected without rebuilding the component. It owns the list cursor, the
 * detail phase, and the output pane; spawning, cancelling, and collecting stay
 * in the command and background runtime.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { stripControlChars } from "../../lib/format.ts";
import { dockListFrame, screenHint, type ScreenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { clip } from "../../lib/tui/columns.ts";
import { fitRows, formatRange, IdCursor, isCloseKey, navIntent, wheelDelta } from "../../lib/tui/cursor.ts";
import { GLYPHS, SEPARATORS } from "../../lib/tui/glyphs.ts";
import { LinePane } from "../../lib/tui/line-pane.ts";
import { emptyState, keyValueRow, statusRow } from "../../lib/tui/rows.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint, type TuiRole } from "../../lib/tui/tokens.ts";
import type { BackgroundRun, BackgroundStatus } from "./background.ts";
import { canCollect } from "./background.ts";
import { formatBackgroundDuration, formatUsageStats } from "./format.ts";
import { sanitizeLine } from "../../lib/format.ts";

const LIST_DEFAULT_ROWS = 12;
const LIST_CHROME_ROWS = 6;
const DETAIL_DEFAULT_ROWS = 16;

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

/** Stable key for the id-anchored cursor. */
function keyOf(run: BackgroundRun): string {
	return run.id;
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
export class AgentsBoardComponent implements Component {
	private readonly cursor = new IdCursor();
	private readonly pane = new LinePane();
	private phase: "list" | "detail" = "list";
	private detailId: string | undefined;

	constructor(private readonly options: AgentsBoardOptions) {}

	private get theme(): Theme {
		return this.options.theme;
	}

	private get now(): number {
		return (this.options.now ?? Date.now)();
	}

	handleInput(data: string): void {
		if (this.phase === "detail") {
			const run = this.detailRun();
			if (!run) {
				this.phase = "list";
				this.options.requestRender();
				return;
			}
			if (isCloseKey(data)) {
				this.phase = "list";
				this.options.requestRender();
				return;
			}
			if (data === "c" && canCollect(run)) {
				this.options.onCollect(run.id);
				return;
			}
			if (data === "x" && run.status === "running") {
				this.options.onCancel(run.id);
				return;
			}
			if (this.pane.handleKey(data)) this.options.requestRender();
			return;
		}

		if (isCloseKey(data)) {
			this.options.onClose();
			return;
		}
		const runs = this.options.runs();
		if (this.move(data, runs)) return;
		const focused = runs[this.cursor.indexOf(runs, keyOf)];
		if (!focused) return;
		if (matchesKey(data, Key.enter)) {
			this.detailId = focused.id;
			this.pane.open(focused.id, { title: focused.id, lines: outputLines(focused) });
			this.pane.setScroll(0);
			this.phase = "detail";
			this.options.requestRender();
			return;
		}
		if (data === "c" && canCollect(focused)) this.options.onCollect(focused.id);
		else if (data === "x" && focused.status === "running") this.options.onCancel(focused.id);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.phase === "detail") {
			const delta = wheelDelta(event);
			if (delta === undefined) return undefined;
			this.pane.setScroll(this.pane.scroll + delta * 3);
			this.options.requestRender();
			return { handled: true };
		}
		const delta = wheelDelta(event);
		if (delta === undefined) return undefined;
		const runs = this.options.runs();
		const index = this.cursor.indexOf(runs, keyOf);
		this.cursor.select(runs, keyOf, index + delta);
		this.options.requestRender();
		return { handled: true };
	}

	dispose(): void {}

	invalidate(): void {}

	private detailRun(): BackgroundRun | undefined {
		if (this.detailId === undefined) return undefined;
		return this.options.runs().find((run) => run.id === this.detailId);
	}

	/** Apply a navigation key to the stable-id cursor. */
	private move(data: string, runs: readonly BackgroundRun[]): boolean {
		const index = this.cursor.indexOf(runs, keyOf);
		const visible = this.cursor.visible;
		switch (navIntent(data)) {
			case "up":
				this.cursor.select(runs, keyOf, index - 1);
				return true;
			case "down":
				this.cursor.select(runs, keyOf, index + 1);
				return true;
			case "pageUp":
				this.cursor.select(runs, keyOf, index - Math.max(1, visible));
				return true;
			case "pageDown":
				this.cursor.select(runs, keyOf, index + Math.max(1, visible));
				return true;
			case "home":
				this.cursor.select(runs, keyOf, 0);
				return true;
			case "end":
				this.cursor.select(runs, keyOf, runs.length - 1);
				return true;
			default:
				return false;
		}
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		return this.phase === "detail" ? this.renderDetail(w) : this.renderList(w);
	}

	private renderList(w: number): string[] {
		const runs = this.options.runs();
		const header = titleRule(this.theme, w, "Agents");
		if (runs.length === 0) {
			return dockListFrame({
				header,
				body: emptyState(this.theme, w, { label: "No background subagents yet." }),
				hint: screenHint(this.theme, w, ["Esc close"]),
			});
		}

		this.cursor.clamp(runs, keyOf);
		this.cursor.visible = fitRows(this.options.viewportRows, runs.length, LIST_CHROME_ROWS, LIST_DEFAULT_ROWS);
		const start = this.cursor.scroll;
		const end = Math.min(runs.length, start + this.cursor.visible);
		const clipped = start > 0 || end < runs.length;
		const body: string[] = [];
		for (let index = start; index < end; index++) {
			const run = runs[index];
			const view = statusView(run.status);
			const usage = run.usage ? formatUsageStats(run.usage) : "";
			const trailing = [view.label, formatBackgroundDuration(run, this.now), usage]
				.filter(Boolean)
				.join(SEPARATORS.item);
			body.push(
				statusRow(this.theme, w, {
					selected: index === this.cursor.indexOf(runs, keyOf),
					glyph: view.glyph,
					glyphRole: view.role,
					label: `${run.id} ${sanitizeLine(run.agent)}  ${taskLabel(run)}`,
					trailing,
				}),
			);
		}

		const focused = runs[this.cursor.indexOf(runs, keyOf)];
		const running = runs.filter((run) => run.status === "running").length;
		const detail = focused
			? `${focused.id} ${sanitizeLine(focused.agent)}${SEPARATORS.item}${statusView(focused.status).label}${SEPARATORS.item}${formatBackgroundDuration(focused, this.now)}`
			: "";
		const hints: ScreenHint[] = ["Esc close", { text: "Enter detail", color: "accent" }];
		if (focused && canCollect(focused)) hints.push({ text: "c collect", color: "accent" });
		if (focused?.status === "running") hints.push({ text: "x cancel", color: "warning" });
		hints.push("↑/↓ select");
		return dockListFrame({
			header,
			summary: clip(
				`  ${paint(this.theme, "meta", `${runs.length} run${runs.length === 1 ? "" : "s"}${running ? `${SEPARATORS.item}${running} running` : ""}`)}`,
				w,
			),
			body,
			range: clipped ? formatRange(this.theme, w, { start, end, total: runs.length }) : undefined,
			detail: detail ? [clip(`  ${paint(this.theme, "meta", detail)}`, w)] : undefined,
			hint: screenHint(this.theme, w, hints),
		});
	}

	private renderDetail(w: number): string[] {
		const run = this.detailRun();
		if (!run) {
			this.phase = "list";
			return this.renderList(w);
		}
		this.pane.update({ lines: outputLines(run) });
		const rows = detailRows(run, this.now, this.theme, w);
		const chrome = 6 + rows.length;
		this.pane.visible = fitRows(this.options.viewportRows, this.pane.count, chrome, DETAIL_DEFAULT_ROWS);
		this.pane.fit(this.pane.visible);
		const { start, end } = this.pane.window();
		const body = rows;
		if (body.length > 0) body.push("");
		for (const line of this.pane.lines.slice(start, end)) {
			body.push(clip(paint(this.theme, "label", line), w));
		}
		if (this.pane.count === 0) body.push(...emptyState(this.theme, w, { label: "(no output recorded)" }));
		const hint: ScreenHint[] = ["Esc back"];
		if (canCollect(run)) hint.push({ text: "c collect", color: "accent" });
		if (run.status === "running") hint.push({ text: "x cancel", color: "warning" });
		hint.push("j/k scroll");
		return dockListFrame({
			header: titleRule(this.theme, w, "Agents"),
			summary: clip(
				`  ${paint(this.theme, "meta", `${run.id} ${sanitizeLine(run.agent)}${SEPARATORS.item}${statusView(run.status).label}${SEPARATORS.item}${formatBackgroundDuration(run, this.now)}`)}`,
				w,
			),
			body,
			range:
				this.pane.count > this.pane.visible
					? formatRange(this.theme, w, { start, end, total: this.pane.count, label: "line" })
					: undefined,
			hint: screenHint(this.theme, w, hint),
		});
	}
}

/**
 * The `/context` screen: one docked report, with the one action the report
 * justifies.
 *
 * The component owns the scroll, the confirm layer, and the feedback line; it
 * owns no host access. The command hands it a report and two callbacks (`read`
 * and `compact`), which keeps the screen testable with a plain object and keeps
 * the host boundary in `collect.ts` / `commands.ts`.
 *
 * The report is re-read on open, on `r`, and after a compaction — never per
 * frame. Arrow keys only move a slice of a body that is already built, so a
 * long session does not re-walk its entries on every keypress.
 */

import type { CompactionResult, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { messageOf } from "../../lib/errors.ts";
import { formatTokens } from "../../lib/format.ts";
import { screenFooter, screenHint, type ViewportRowsSource } from "../../lib/tui/chrome.ts";
import { ConfirmState } from "../../lib/tui/confirm.ts";
import { clampScroll, fitRows, formatRange, isCloseKey, navigateScroll } from "../../lib/tui/cursor.ts";
import { gaugeBar, gaugeRole } from "../../lib/tui/gauge.ts";
import { BODY_INDENT } from "../../lib/tui/indent.ts";
import { titleRule } from "../../lib/tui/rules.ts";
import { paint, type TuiRole } from "../../lib/tui/tokens.ts";
import { formatBudget, formatCompaction, formatDrift } from "./format.ts";
import type { ContextBucket, ContextReport } from "./types.ts";

/** Fixed rows around the scrollable body: title, gauge, budget, blank, blank, footer, closing rule. */
const CHROME_ROWS = 7;

/** Cells in the composition bar. */
const BUCKET_BLOCKS = 8;

/** Body rows when the terminal height is unknown. */
const DEFAULT_BODY_ROWS = 12;

/** What the compact action needs from the screen. */
export interface ContextCompactCallbacks {
	done(result: CompactionResult): void;
	fail(error: unknown): void;
}

/** Everything the screen needs; the command supplies the host work. */
export interface ContextScreenOptions {
	theme: Theme;
	/** The report as opened. */
	report: ContextReport;
	/** Re-collect and rebuild the report. */
	read(): ContextReport;
	/** Whether the agent is busy (a turn or a compaction); compaction is refused while it is. */
	isIdle(): boolean;
	/** Start the host's compaction with custom instructions, or the plain one. */
	compact(instructions: string | undefined, callbacks: ContextCompactCallbacks): void;
	/** Close the screen. */
	close(): void;
	/** Ask the host to repaint. */
	requestRender(): void;
	/** Terminal height, read fresh so a resize is picked up. */
	viewportRowsSource?: ViewportRowsSource;
}

/** A feedback message and the role it is painted in. */
interface Feedback {
	text: string;
	role: TuiRole;
}

/** A right-aligned cell in a composition row. */
function shareCell(share: number): string {
	return `${share.toFixed(1)}%`.padStart(6);
}

/** Pad a label to its column with spaces, measured in terminal columns. */
function padCell(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "…");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

/** The scrollable, read-only report. */
export class ContextComponent implements Component {
	private report: ContextReport;
	private scroll = 0;
	private visible = DEFAULT_BODY_ROWS;
	private body: string[] = [];
	private feedback: Feedback | undefined;
	private readonly confirm = new ConfirmState();

	constructor(private readonly options: ContextScreenOptions) {
		this.report = options.report;
	}

	private get theme(): Theme {
		return this.options.theme;
	}

	/** Replace the report from the host and repaint. */
	private refresh(): void {
		this.report = this.options.read();
		this.requestRender();
	}

	private requestRender(): void {
		this.options.requestRender();
	}

	private setFeedback(text: string, role: TuiRole): void {
		this.feedback = { text, role };
		this.requestRender();
	}

	/** Ask before compacting, then run the action only once the turn is idle. */
	private askCompact(): void {
		this.confirm.ask("Compact the conversation now? y/N", () => {
			if (!this.options.isIdle()) {
				this.setFeedback("The agent is busy (a turn or a compaction is running); wait for it to finish.", "warn");
				return;
			}
			this.feedback = { text: "Compacting…", role: "meta" };
			this.requestRender();
			this.options.compact(undefined, {
				done: (result) => {
					this.report = this.options.read();
					const after = result.estimatedTokensAfter === undefined ? "?" : formatTokens(result.estimatedTokensAfter);
					this.setFeedback(`Compacted ${formatTokens(result.tokensBefore)} → ${after}`, "ok");
				},
				fail: (error) => {
					this.setFeedback(`Compaction failed: ${messageOf(error)}`, "bad");
				},
			});
		});
		this.requestRender();
	}

	/** The gauge line: the host's number, its bar, and its percentage. */
	private gaugeLine(width: number): string {
		const { percent, tokens, window } = this.report;
		if (window <= 0) return truncateToWidth(`  ${paint(this.theme, "meta", "no model context window")}`, width);
		const role = gaugeRole(percent);
		// The bar and the printed percentage come from one rounded value, so a
		// label reading `0%` can never sit beside a filled cell. The tone stays on
		// the exact percent, so the warn and danger thresholds do not move.
		const shown = percent === null ? null : Math.round(percent);
		const value = tokens === null ? `? / ${formatTokens(window)}` : `${formatTokens(tokens)} / ${formatTokens(window)}`;
		const bar = gaugeBar(this.theme, { percent: shown, blocks: 10 });
		const label = shown === null ? "unknown" : `${shown}%`;
		return truncateToWidth(`  ${paint(this.theme, role, value)}  ${bar}  ${paint(this.theme, role, label)}`, width);
	}

	/** The composition header: the denominator the percent column is a share of. */
	private compositionLine(width: number): string {
		const label = paint(this.theme, "label", "Composition");
		const total = paint(this.theme, "meta", `${formatTokens(this.report.estimate)} estimate`);
		const full = `  ${label} · ${total}`;
		return visibleWidth(full) <= width ? full : truncateToWidth(`  ${label}`, width);
	}

	/** One composition row; optional columns drop as the terminal narrows. */
	private bucketLine(bucket: ContextBucket, width: number): string {
		const indent = " ".repeat(bucket.depth > 0 ? 4 : 2);
		const labelWidth = bucket.depth > 0 ? 20 : 22;
		const label = padCell(bucket.label, labelWidth);
		const tokens = formatTokens(bucket.tokens).padStart(6);
		const share = shareCell(bucket.share);
		const note = bucket.note ? `  ${bucket.note}` : "";
		const bar = gaugeBar(this.theme, {
			percent: bucket.share,
			blocks: BUCKET_BLOCKS,
			role: "meta",
			emptyRole: "faint",
		});
		const head = `${indent}${paint(this.theme, "label", label)}${paint(this.theme, "meta", tokens)}`;
		// Keep the tokens and the label above a trailing note, then the percentage,
		// then the bar, so a narrow terminal still reads "what" and "how much".
		const candidates = [`${head}  ${share}  ${bar}${note}`, `${head}  ${share}${note}`, `${head}${note}`, head];
		for (const candidate of candidates) {
			if (visibleWidth(candidate) <= width) return candidate;
		}
		return truncateToWidth(head, width);
	}

	/** The scrollable body: composition, drift, compaction, and the largest messages. */
	private buildBody(width: number): string[] {
		const report = this.report;
		const lines: string[] = [];
		if (report.buckets.length > 0) {
			lines.push(this.compositionLine(width));
			for (const bucket of report.buckets) lines.push(this.bucketLine(bucket, width));
		}

		const drift = formatDrift(report);
		if (drift) lines.push("", truncateToWidth(`  ${paint(this.theme, "meta", drift)}`, width));

		lines.push(
			"",
			truncateToWidth(
				`  ${paint(this.theme, "label", "Compaction")}  ${paint(this.theme, "meta", formatCompaction(report))}`,
				width,
			),
		);

		if (report.largest.length > 0) {
			lines.push("", `  ${paint(this.theme, "label", "Largest messages")}`);
			for (const block of report.largest) {
				const tokens = formatTokens(block.tokens).padStart(6);
				const role = padCell(block.role, 12);
				const candidate = `    ${paint(this.theme, "meta", tokens)}  ${paint(this.theme, "label", role)}${block.label}`;
				lines.push(truncateToWidth(candidate, width));
			}
		}
		return lines;
	}

	/** The footer: a feedback line, the pending confirmation, or the key hints. */
	private footerLine(width: number): string {
		const pending = this.confirm.pending;
		if (pending) return truncateToWidth(`  ${paint(this.theme, "warn", pending.prompt)}`, width);
		if (this.feedback) return truncateToWidth(`  ${paint(this.theme, this.feedback.role, this.feedback.text)}`, width);
		return screenHint(
			this.theme,
			width,
			[
				{ text: "c compact", color: "accent" },
				{ text: "r refresh", color: "faint" },
				{ text: "↑↓ scroll", color: "faint" },
				{ text: "Esc close", color: "faint" },
			],
			BODY_INDENT,
		);
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		this.body = this.buildBody(w);
		this.visible = fitRows(this.options.viewportRowsSource, this.body.length, CHROME_ROWS, DEFAULT_BODY_ROWS);
		this.scroll = clampScroll(this.scroll, this.body.length, this.visible);

		const end = Math.min(this.body.length, this.scroll + this.visible);
		const lines = [
			titleRule(this.theme, w, "Context"),
			this.gaugeLine(w),
			truncateToWidth(`  ${paint(this.theme, "meta", formatBudget(this.report))}`, w),
			"",
			...this.body.slice(this.scroll, end),
		];
		if (this.body.length > this.visible) {
			lines.push(formatRange(this.theme, w, { start: this.scroll, end, total: this.body.length }));
		}
		lines.push(...screenFooter(this.theme, w, this.footerLine(w)));
		return lines.map((line) => truncateToWidth(line, w));
	}

	handleInput(data: string): void {
		const outcome = this.confirm.resolve(data);
		if (outcome) {
			this.requestRender();
			return;
		}
		if (data === "g" || data === "G") {
			this.scroll = data === "g" ? 0 : Math.max(0, this.body.length - this.visible);
			this.requestRender();
			return;
		}
		const next = navigateScroll(data, this.scroll, this.body.length, this.visible);
		if (next !== undefined) {
			this.scroll = next;
			this.requestRender();
			return;
		}
		if (data === "c") {
			this.askCompact();
			return;
		}
		if (data === "r") {
			this.feedback = { text: "Refreshed.", role: "meta" };
			this.refresh();
			return;
		}
		if (isCloseKey(data) || data === "q") this.options.close();
	}

	/** A read-only report caches nothing, so a theme change has nothing to drop. */
	invalidate(): void {}
}

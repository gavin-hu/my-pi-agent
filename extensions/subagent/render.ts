/**
 * Transcript rendering for the `subagent` tool.
 *
 * `renderCall` previews the requested mode before execution; `renderResult`
 * draws a collapsed summary or an expanded, per-result view. They are pure over
 * the tool arguments/details, so tests can call `.render(width)` directly; the
 * optional render context only drives the running elapsed-time repaint.
 *
 * Status and error rendering is shared across single- and multi-result modes so
 * a failed task never loses its message, regardless of how many tasks ran.
 */

import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Container, Markdown, Spacer, Text, type Component } from "@earendil-works/pi-tui";
import { sanitize } from "../_shared/format.ts";
import { aggregateUsage, clip, formatToolCall, formatUsageStats, shortenPath } from "./format.ts";
import { COLLAPSED_ERROR_MAX, COLLAPSED_ITEM_COUNT, COLLAPSED_TEXT_LINES, type SubagentArgs } from "./schema.ts";
import { getFinalOutput, isFailedResult } from "./stream.ts";
import type { SingleResult, SubagentDetails } from "./types.ts";

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };
type ResultStatus = "running" | "aborted" | "failed" | "success";

/** Text and tool-call parts of every assistant message, in order. */
function getDisplayItems(messages: SingleResult["messages"]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type === "text") items.push({ type: "text", text: part.text });
			else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
		}
	}
	return items;
}

/** Whether a collapsed result hides items or lines that expanding would reveal. */
function hasExpandableContent(items: DisplayItem[]): boolean {
	return (
		items.length > COLLAPSED_ITEM_COUNT ||
		items.some((item) => item.type === "text" && item.text.split("\n").length > COLLAPSED_TEXT_LINES)
	);
}

const STATUS_META: Record<ResultStatus, { color: "warning" | "error" | "success"; glyph: string }> = {
	running: { color: "warning", glyph: "⏳" },
	aborted: { color: "warning", glyph: "⊘" },
	failed: { color: "error", glyph: "✗" },
	success: { color: "success", glyph: "✓" },
};

/** Classify a result. `isPartial` marks a still-streaming single result. */
function resultStatus(result: SingleResult, isPartial = false): ResultStatus {
	if (isPartial || result.exitCode === -1) return "running";
	if (result.stopReason === "aborted") return "aborted";
	if (isFailedResult(result)) return "failed";
	return "success";
}

function statusIcon(status: ResultStatus, theme: Theme): string {
	const meta = STATUS_META[status];
	return theme.fg(meta.color, meta.glyph);
}

/** The color the status uses, so the `[stopReason]` bracket matches its icon. */
function statusColor(status: ResultStatus): "warning" | "error" | "success" {
	return STATUS_META[status].color;
}

/** The message a failed/aborted result should show, falling back to stderr. */
function errorDetail(result: SingleResult, status: ResultStatus, max?: number): string | undefined {
	if (status !== "failed" && status !== "aborted") return undefined;
	const detail = result.errorMessage || result.stderr.trim();
	if (!detail) return undefined;
	return max === undefined ? detail : clip(sanitize(detail), max);
}

/** A "Error: ..." / "Aborted: ..." block, or undefined when clean. */
function renderError(result: SingleResult, status: ResultStatus, theme: Theme, max?: number): string | undefined {
	const detail = errorDetail(result, status, max);
	if (!detail) return undefined;
	const label = status === "aborted" ? "Aborted" : "Error";
	return theme.fg(status === "aborted" ? "warning" : "error", `${label}: ${detail}`);
}

/** Whether the collapsed error/stderr text is truncated, so expanding shows more. */
function hasClippedError(result: SingleResult, status: ResultStatus): boolean {
	const full = errorDetail(result, status);
	if (!full) return false;
	const clean = sanitize(full);
	return clip(clean, COLLAPSED_ERROR_MAX) !== clean;
}

/** The lines under a collapsed result header: error, output preview, or a placeholder. */
function collapsedBody(result: SingleResult, status: ResultStatus, items: DisplayItem[], theme: Theme): string {
	const error = renderError(result, status, theme, COLLAPSED_ERROR_MAX);
	if (error) return `\n${error}`;
	if (items.length === 0) return `\n${theme.fg("muted", status === "running" ? "(running...)" : "(no output)")}`;
	return `\n${renderDisplayItems(items, theme, COLLAPSED_ITEM_COUNT)}`;
}

/** Whether expanding a collapsed result would reveal more than its preview. */
function isExpandable(result: SingleResult, status: ResultStatus, items: DisplayItem[]): boolean {
	return hasExpandableContent(items) || hasClippedError(result, status);
}

/** "2 tool errors" / "1 tool error". */
function toolErrorsLabel(count: number): string {
	return `${count} tool error${count > 1 ? "s" : ""}`;
}

/** Usage plus a tool-error count when the subagent hit any. */
function usageLine(result: SingleResult): string {
	const base = formatUsageStats(result.usage, result.model);
	if (!result.toolErrors) return base;
	const label = toolErrorsLabel(result.toolErrors);
	return base ? `${base} ${label}` : label;
}

/** The `Total:` usage line for a multi run, including summed tool errors. */
function totalUsageLine(results: SingleResult[]): string {
	const usage = formatUsageStats(aggregateUsage(results));
	const errors = results.reduce((sum, result) => sum + (result.toolErrors ?? 0), 0);
	const label = errors ? toolErrorsLabel(errors) : "";
	return [usage, label].filter(Boolean).join(" ");
}

function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return rest ? `${minutes}m${rest}s` : `${minutes}m`;
}

/** " 12s" while running or once finished, or "" when no start time was recorded. */
function durationSuffix(result: SingleResult, status: ResultStatus): string {
	if (!result.startedAt) return "";
	const end = result.finishedAt ?? (status === "running" ? Date.now() : undefined);
	if (end === undefined) return "";
	return ` ${formatDuration(end - result.startedAt)}`;
}

/** Elapsed time plus a `[stopReason]` bracket, unless the result is clean or still running. */
function statusSuffix(result: SingleResult, status: ResultStatus, theme: Theme): string {
	let suffix = "";
	const duration = durationSuffix(result, status);
	if (duration) suffix += theme.fg("dim", duration);
	if (result.stopReason && status !== "success" && status !== "running") {
		suffix += ` ${theme.fg(statusColor(status), `[${result.stopReason}]`)}`;
	}
	return suffix;
}

/** A result header line: status icon, agent, and status suffix. */
function resultHeader(result: SingleResult, status: ResultStatus, theme: Theme, stepPrefix: string): string {
	let header = `${statusIcon(status, theme)} ${theme.fg("toolTitle", theme.bold(result.agent))}`;
	if (result.step) header = `${theme.fg("muted", `${stepPrefix} ${result.step} `)}` + header;
	return header + statusSuffix(result, status, theme);
}

/** Prefix each line of intermediate assistant text with a muted gutter. */
function quoteLines(text: string, theme: Theme): string {
	return text
		.trim()
		.split("\n")
		.map((line) => theme.fg("muted", "│ ") + theme.fg("toolOutput", line))
		.join("\n");
}

function renderDisplayItems(items: DisplayItem[], theme: Theme, limit?: number, preview = true): string {
	const shown = limit ? items.slice(-limit) : items;
	const skipped = limit && items.length > limit ? items.length - limit : 0;
	const lines: string[] = [];
	if (skipped > 0) lines.push(theme.fg("muted", `... ${skipped} earlier items`));
	for (const item of shown) {
		if (item.type === "text") {
			const text = preview ? item.text.split("\n").slice(0, COLLAPSED_TEXT_LINES).join("\n") : item.text;
			lines.push(theme.fg("toolOutput", text));
		} else {
			lines.push(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme, preview));
		}
	}
	return lines.join("\n");
}

/** "2. explorer" for a parallel task, or "Step 2: explorer" for a chain step. */
function resultLabel(result: SingleResult, index: number): string {
	const prefix = result.step ? `Step ${result.step}: ` : `${index + 1}. `;
	return prefix + result.agent;
}

/** Preview the requested mode and its agents. */
export function renderSubagentCall(args: SubagentArgs, theme: Theme, context?: { cwd?: string }): Component {
	const title = theme.fg("toolTitle", theme.bold("subagent "));
	const cwdNote = (cwd?: string) => {
		if (!cwd || cwd === context?.cwd) return "";
		return theme.fg("dim", `  in ${shortenPath(cwd)}`);
	};

	if (args.chain && args.chain.length > 0) {
		let text = title + theme.fg("accent", `chain · ${args.chain.length} step${args.chain.length > 1 ? "s" : ""}`);
		for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
			const step = args.chain[i];
			const clean = sanitize(step.task.replace(/\{previous\}/g, ""));
			text += `\n  ${theme.fg("muted", `${i + 1}.`)} ${theme.fg("accent", step.agent)}${theme.fg("dim", ` ${clip(clean, 40)}`)}${cwdNote(step.cwd)}`;
		}
		if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
		return new Text(text, 0, 0);
	}

	if (args.tasks && args.tasks.length > 0) {
		let text = title + theme.fg("accent", `parallel · ${args.tasks.length} task${args.tasks.length > 1 ? "s" : ""}`);
		for (let i = 0; i < Math.min(args.tasks.length, 3); i++) {
			const task = args.tasks[i];
			text += `\n  ${theme.fg("muted", `${i + 1}.`)} ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${clip(sanitize(task.task), 40)}`)}${cwdNote(task.cwd)}`;
		}
		if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
		return new Text(text, 0, 0);
	}

	const agentName = args.agent || "...";
	let text = title + theme.fg("accent", agentName) + cwdNote(args.cwd);
	text += `\n  ${theme.fg("dim", clip(sanitize(args.task ?? "..."), 60))}`;
	return new Text(text, 0, 0);
}

/** Append one result's expanded block: header, error, task, output, usage. */
function addExpandedResult(
	container: Container,
	result: SingleResult,
	theme: Theme,
	mdTheme: ReturnType<typeof getMarkdownTheme>,
	isPartial = false,
): void {
	const status = resultStatus(result, isPartial);
	container.addChild(new Text(resultHeader(result, status, theme, "Step"), 0, 0));
	const error = renderError(result, status, theme);
	if (error) container.addChild(new Text(error, 0, 0));

	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
	container.addChild(new Text(theme.fg("dim", result.task), 0, 0));

	const displayItems = getDisplayItems(result.messages);
	const lastItem = displayItems[displayItems.length - 1];
	const finalOutput = getFinalOutput(result.messages);
	// Only hoist a trailing Markdown block when the final output really is the
	// last thing the agent emitted; otherwise render items in their original
	// order and do not surface a stale earlier message as the answer.
	const trailingOutput = lastItem?.type === "text" && lastItem.text === finalOutput ? lastItem.text : "";
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
	let renderedOutput = false;
	for (const item of displayItems) {
		if (item.type === "toolCall") {
			container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme, false), 0, 0));
			renderedOutput = true;
		} else if (item.text.trim() && item.text !== trailingOutput) {
			container.addChild(new Text(quoteLines(item.text, theme), 0, 0));
			renderedOutput = true;
		}
	}
	if (trailingOutput.trim()) {
		container.addChild(new Spacer(1));
		container.addChild(new Markdown(trailingOutput.trim(), 0, 0, mdTheme));
		renderedOutput = true;
	}
	if (!renderedOutput) {
		container.addChild(new Text(theme.fg("muted", status === "running" ? "(running...)" : "(no output)"), 0, 0));
	}

	const usage = usageLine(result);
	if (usage) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("dim", usage), 0, 0));
	}
}

function expandedResult(result: SingleResult, theme: Theme, mdTheme: ReturnType<typeof getMarkdownTheme>, isPartial: boolean): Container {
	const container = new Container();
	addExpandedResult(container, result, theme, mdTheme, isPartial);
	return container;
}

function collapsedResult(result: SingleResult, theme: Theme, isPartial: boolean): Text {
	const status = resultStatus(result, isPartial);
	let text = resultHeader(result, status, theme, "step");

	const displayItems = getDisplayItems(result.messages);
	text += collapsedBody(result, status, displayItems, theme);
	if (isExpandable(result, status, displayItems)) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	const usage = usageLine(result);
	if (usage) text += `\n${theme.fg("dim", usage)}`;
	return new Text(text, 0, 0);
}

function summarizeResults(results: SingleResult[]) {
	const statuses = results.map((result) => resultStatus(result));
	return {
		running: statuses.filter((status) => status === "running").length,
		failed: statuses.filter((status) => status === "failed").length,
		aborted: statuses.filter((status) => status === "aborted").length,
		succeeded: statuses.filter((status) => status === "success").length,
	};
}

/** Shared header for parallel/chain results, with a failure count when present. */
function multiHeader(details: SubagentDetails, theme: Theme): string {
	const { running, failed, aborted, succeeded } = summarizeResults(details.results);
	const total = details.total ?? details.results.length;
	const noun = details.mode === "chain" ? "steps" : "tasks";

	let status: string;
	if (running > 0) {
		// Parallel findings are placeholder-backed, so `total - running` really are
		// finished. A chain only holds started steps, so report the current step.
		status =
			details.mode === "chain"
				? `${succeeded}/${total} ${noun} done, step ${details.results.length} running`
				: `${total - running}/${total} ${noun} done, ${running} running`;
	} else {
		status = `${succeeded}/${total} ${noun}`;
	}
	const issues: string[] = [];
	if (failed) issues.push(`${failed} failed`);
	if (aborted) issues.push(`${aborted} aborted`);
	if (issues.length) status += ` (${issues.join(", ")})`;

	const bad = failed + aborted;
	const icon =
		running > 0
			? theme.fg("warning", "⏳")
			: bad > 0
				? theme.fg(bad === total ? "error" : "warning", bad === total ? "✗" : "◐")
				: theme.fg("success", "✓");
	return `${icon} ${theme.fg("toolTitle", theme.bold(`${details.mode} · `))}${theme.fg("accent", status)}`;
}

function collapsedMulti(details: SubagentDetails, theme: Theme): Text {
	const results = details.results;
	const { running } = summarizeResults(results);
	let text = multiHeader(details, theme);

	let hasHidden = false;
	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		const status = resultStatus(result);
		const displayItems = getDisplayItems(result.messages);
		if (isExpandable(result, status, displayItems)) hasHidden = true;
		const taskNote = result.task ? theme.fg("dim", ` ${clip(sanitize(result.task), 50)}`) : "";
		text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", resultLabel(result, i))}${taskNote} ${statusIcon(status, theme)}`;
		text += statusSuffix(result, status, theme);
		text += collapsedBody(result, status, displayItems, theme);
	}
	if (running === 0) {
		const usage = totalUsageLine(results);
		if (usage) text += `\n\n${theme.fg("dim", `Total: ${usage}`)}`;
	}
	if (running > 0 || hasHidden) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	return new Text(text, 0, 0);
}

function expandedMulti(details: SubagentDetails, theme: Theme): Container {
	const container = new Container();
	const mdTheme = getMarkdownTheme();
	container.addChild(new Text(multiHeader(details, theme), 0, 0));

	for (const result of details.results) {
		container.addChild(new Spacer(1));
		addExpandedResult(container, result, theme, mdTheme);
	}

	const { running } = summarizeResults(details.results);
	if (running === 0) {
		const usage = totalUsageLine(details.results);
		if (usage) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", `Total: ${usage}`), 0, 0));
		}
	}
	return container;
}

/** The subset of Pi's render context the elapsed timer needs. */
interface ElapsedRenderContext {
	state: Record<string, unknown>;
	invalidate: () => void;
}

/** Keep a 1s repaint ticking while any result is still running, so elapsed labels advance. */
function syncElapsedTimer(running: boolean, context?: ElapsedRenderContext): void {
	if (!context?.state) return;
	const state = context.state as { elapsedTimer?: ReturnType<typeof setInterval> };
	if (running && !state.elapsedTimer) {
		state.elapsedTimer = setInterval(() => context.invalidate(), 1000);
		(state.elapsedTimer as { unref?: () => void }).unref?.();
	} else if (!running && state.elapsedTimer) {
		clearInterval(state.elapsedTimer);
		state.elapsedTimer = undefined;
	}
}

/** Render a subagent result, collapsed or expanded. */
export function renderSubagentResult(
	result: AgentToolResult<unknown>,
	options: { expanded: boolean; isPartial?: boolean },
	theme: Theme,
	context?: ElapsedRenderContext,
): Component {
	const details = result.details as SubagentDetails | undefined;
	if (!details || details.results.length === 0) {
		syncElapsedTimer(false, context);
		const first = result.content[0];
		return new Text(first?.type === "text" ? first.text : "(no output)", 0, 0);
	}

	// The `-1` sentinel is set while a subprocess is in flight, in every mode.
	syncElapsedTimer(details.results.some((entry) => entry.exitCode === -1), context);

	const isPartial = options.isPartial ?? false;
	if (details.mode === "single") {
		const single = details.results[0];
		return options.expanded
			? expandedResult(single, theme, getMarkdownTheme(), isPartial)
			: collapsedResult(single, theme, isPartial);
	}
	return options.expanded ? expandedMulti(details, theme) : collapsedMulti(details, theme);
}

/**
 * Transcript rendering for the `subagent` tool.
 *
 * `renderCall` previews the requested mode before execution; `renderResult`
 * draws a collapsed summary or an expanded, per-result view. Both are pure
 * functions over the tool arguments/details so they can be tested by calling
 * `.render(width)` directly.
 *
 * Status and error rendering is shared across single- and multi-result modes so
 * a failed task never loses its message, regardless of how many tasks ran.
 */

import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Container, Markdown, Spacer, Text, type Component } from "@earendil-works/pi-tui";
import { aggregateUsage, formatToolCall, formatUsageStats, shortenPath } from "./format.ts";
import { COLLAPSED_ITEM_COUNT, type SubagentArgs } from "./schema.ts";
import { getFinalOutput, isFailedResult } from "./stream.ts";
import type { SingleResult, SubagentDetails } from "./types.ts";

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };
type ResultStatus = "running" | "aborted" | "failed" | "success";

/** Text and tool-call parts of every assistant message, in order. */
export function getDisplayItems(messages: SingleResult["messages"]): DisplayItem[] {
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

function clip(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max)}...` : value;
}

const STATUS_META: Record<ResultStatus, { color: "warning" | "error" | "success"; glyph: string }> = {
	running: { color: "warning", glyph: "⏳" },
	aborted: { color: "warning", glyph: "⊘" },
	failed: { color: "error", glyph: "✗" },
	success: { color: "success", glyph: "✓" },
};

/** Classify a result. `isPartial` marks the streaming result before its first event. */
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

/** The message a failed/aborted result should show, falling back to stderr. */
function errorDetail(result: SingleResult, status: ResultStatus): string | undefined {
	if (status !== "failed" && status !== "aborted") return undefined;
	if (result.errorMessage) return result.errorMessage;
	const stderr = result.stderr.trim();
	return stderr || undefined;
}

/** A one-line "Error: ..." / "Aborted: ..." block, or undefined when clean. */
function renderError(result: SingleResult, status: ResultStatus, theme: Theme): string | undefined {
	const detail = errorDetail(result, status);
	if (!detail) return undefined;
	const label = status === "aborted" ? "Aborted" : "Error";
	return theme.fg(status === "aborted" ? "warning" : "error", `${label}: ${detail}`);
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
			const text = preview ? item.text.split("\n").slice(0, 3).join("\n") : item.text;
			lines.push(theme.fg("toolOutput", text));
		} else {
			lines.push(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme, preview));
		}
	}
	return lines.join("\n");
}

function resultLabel(result: SingleResult): string {
	return result.step ? `Step ${result.step}: ${result.agent}` : result.agent;
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
			const clean = step.task.replace(/\{previous\}/g, "").trim();
			text += `\n  ${theme.fg("muted", `${i + 1}.`)} ${theme.fg("accent", step.agent)}${theme.fg("dim", ` ${clip(clean, 40)}`)}${cwdNote(step.cwd)}`;
		}
		if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
		return new Text(text, 0, 0);
	}

	if (args.tasks && args.tasks.length > 0) {
		let text = title + theme.fg("accent", `parallel · ${args.tasks.length} task${args.tasks.length > 1 ? "s" : ""}`);
		for (let i = 0; i < Math.min(args.tasks.length, 3); i++) {
			const task = args.tasks[i];
			text += `\n  ${theme.fg("muted", `${i + 1}.`)} ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${clip(task.task, 40)}`)}${cwdNote(task.cwd)}`;
		}
		if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
		return new Text(text, 0, 0);
	}

	const agentName = args.agent || "...";
	let text = title + theme.fg("accent", agentName) + cwdNote(args.cwd);
	text += `\n  ${theme.fg("dim", clip(args.task ?? "...", 60))}`;
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
	let headerText = `${statusIcon(status, theme)} ${theme.fg("toolTitle", theme.bold(result.agent))}`;
	if (result.step) headerText = `${theme.fg("muted", `Step ${result.step} `)}` + headerText;
	const duration = durationSuffix(result, status);
	if (duration) headerText += theme.fg("dim", duration);
	if (result.stopReason && status !== "success" && status !== "running") headerText += ` ${theme.fg("error", `[${result.stopReason}]`)}`;
	container.addChild(new Text(headerText, 0, 0));
	const error = renderError(result, status, theme);
	if (error) container.addChild(new Text(error, 0, 0));

	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
	container.addChild(new Text(theme.fg("dim", result.task), 0, 0));

	const displayItems = getDisplayItems(result.messages);
	const finalOutput = getFinalOutput(result.messages);
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
	if (displayItems.length === 0 && !finalOutput) {
		container.addChild(new Text(theme.fg("muted", status === "running" ? "(running...)" : "(no output)"), 0, 0));
	} else {
		for (const item of displayItems) {
			if (item.type === "toolCall") {
				container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme, false), 0, 0));
			} else if (item.text.trim() && item.text !== finalOutput) {
				container.addChild(new Text(quoteLines(item.text, theme), 0, 0));
			}
		}
		if (finalOutput) {
			container.addChild(new Spacer(1));
			container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
		}
	}

	const usage = formatUsageStats(result.usage, result.model);
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
	const icon = statusIcon(status, theme);
	let text = `${icon} ${theme.fg("toolTitle", theme.bold(result.agent))}`;
	if (result.step) text = `${theme.fg("muted", `step ${result.step} `)}` + text;
	const duration = durationSuffix(result, status);
	if (duration) text += theme.fg("dim", duration);
	if (result.stopReason && status !== "success" && status !== "running") text += ` ${theme.fg("error", `[${result.stopReason}]`)}`;

	const displayItems = getDisplayItems(result.messages);
	const error = renderError(result, status, theme);
	if (error) {
		text += `\n${error}`;
	} else if (displayItems.length === 0) {
		text += `\n${theme.fg("muted", status === "running" ? "(running...)" : "(no output)")}`;
	} else {
		text += `\n${renderDisplayItems(displayItems, theme, COLLAPSED_ITEM_COUNT)}`;
		if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	}
	const usage = formatUsageStats(result.usage, result.model);
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
	const total = details.results.length;
	const finished = total - running;
	const noun = details.mode === "chain" ? "steps" : "tasks";

	let status: string;
	if (running > 0) {
		status = `${finished}/${total} ${noun} done, ${running} running`;
	} else {
		status = `${succeeded}/${total} ${noun}`;
		const issues: string[] = [];
		if (failed) issues.push(`${failed} failed`);
		if (aborted) issues.push(`${aborted} aborted`);
		if (issues.length) status += ` (${issues.join(", ")})`;
	}

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

	for (const result of results) {
		const status = resultStatus(result);
		const displayItems = getDisplayItems(result.messages);
		text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", resultLabel(result))} ${statusIcon(status, theme)}`;
		const duration = durationSuffix(result, status);
		if (duration) text += theme.fg("dim", duration);
		const error = renderError(result, status, theme);
		if (error) {
			text += `\n${error}`;
		} else if (displayItems.length === 0) {
			text += `\n${theme.fg("muted", status === "running" ? "(running...)" : "(no output)")}`;
		} else {
			text += `\n${renderDisplayItems(displayItems, theme, COLLAPSED_ITEM_COUNT)}`;
		}
	}
	if (running === 0) {
		const usage = formatUsageStats(aggregateUsage(results));
		if (usage) text += `\n\n${theme.fg("dim", `Total: ${usage}`)}`;
	}
	const hasHidden = results.some((result) => getDisplayItems(result.messages).length > COLLAPSED_ITEM_COUNT);
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
		const usage = formatUsageStats(aggregateUsage(details.results));
		if (usage) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", `Total: ${usage}`), 0, 0));
		}
	}
	return container;
}

/** Render a subagent result, collapsed or expanded. */
export function renderSubagentResult(
	result: AgentToolResult<unknown>,
	options: { expanded: boolean; isPartial?: boolean },
	theme: Theme,
): Component {
	const details = result.details as SubagentDetails | undefined;
	if (!details || details.results.length === 0) {
		const first = result.content[0];
		return new Text(first?.type === "text" ? first.text : "(no output)", 0, 0);
	}

	const isPartial = options.isPartial ?? false;
	if (details.results.length === 1) {
		return options.expanded
			? expandedResult(details.results[0], theme, getMarkdownTheme(), isPartial)
			: collapsedResult(details.results[0], theme, isPartial);
	}
	return options.expanded ? expandedMulti(details, theme) : collapsedMulti(details, theme);
}

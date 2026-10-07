/**
 * Transcript rendering for the `subagent` tool.
 *
 * `renderCall` previews the requested mode before execution; `renderResult`
 * draws a collapsed summary or an expanded, per-result view. Both are pure
 * functions over the tool arguments/details so they can be tested by calling
 * `.render(width)` directly.
 */

import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Container, Markdown, Spacer, Text, type Component } from "@earendil-works/pi-tui";
import { aggregateUsage, formatToolCall, formatUsageStats } from "./format.ts";
import { COLLAPSED_ITEM_COUNT, type SubagentArgs } from "./schema.ts";
import { getFinalOutput, isFailedResult } from "./stream.ts";
import type { SingleResult, SubagentDetails } from "./types.ts";

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

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

function resultIcon(result: SingleResult, theme: Theme): string {
	if (result.exitCode === -1) return theme.fg("warning", "⏳");
	return isFailedResult(result) ? theme.fg("error", "✗") : theme.fg("success", "✓");
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

/** Preview the requested mode and its agents. */
export function renderSubagentCall(args: SubagentArgs, theme: Theme): Component {
	const header = (label: string, count: number) =>
		theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", `${label} (${count})`);

	if (args.chain && args.chain.length > 0) {
		let text = header(`chain ${args.chain.length} step${args.chain.length > 1 ? "s" : ""}`, args.chain.length);
		for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
			const step = args.chain[i];
			const clean = step.task.replace(/\{previous\}/g, "").trim();
			text += `\n  ${theme.fg("muted", `${i + 1}.`)} ${theme.fg("accent", step.agent)}${theme.fg("dim", ` ${clip(clean, 40)}`)}`;
		}
		if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
		return new Text(text, 0, 0);
	}

	if (args.tasks && args.tasks.length > 0) {
		let text = header(`parallel ${args.tasks.length} task${args.tasks.length > 1 ? "s" : ""}`, args.tasks.length);
		for (const task of args.tasks.slice(0, 3)) {
			text += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${clip(task.task, 40)}`)}`;
		}
		if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
		return new Text(text, 0, 0);
	}

	const agentName = args.agent || "...";
	let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", agentName);
	text += `\n  ${theme.fg("dim", clip(args.task ?? "...", 60))}`;
	return new Text(text, 0, 0);
}

function expandedResult(result: SingleResult, theme: Theme, mdTheme = getMarkdownTheme()): Container {
	const container = new Container();
	const icon = resultIcon(result, theme);
	let headerText = `${icon} ${theme.fg("toolTitle", theme.bold(result.agent))}`;
	if (result.step) headerText = `${theme.fg("muted", `step ${result.step} `)}` + headerText;
	if (isFailedResult(result) && result.stopReason) headerText += ` ${theme.fg("error", `[${result.stopReason}]`)}`;
	container.addChild(new Text(headerText, 0, 0));
	if (isFailedResult(result) && result.errorMessage) {
		container.addChild(new Text(theme.fg("error", `Error: ${result.errorMessage}`), 0, 0));
	}
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
	container.addChild(new Text(theme.fg("dim", result.task), 0, 0));

	const displayItems = getDisplayItems(result.messages);
	const finalOutput = getFinalOutput(result.messages);
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
	if (displayItems.length === 0 && !finalOutput) {
		container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
	} else {
		for (const item of displayItems) {
			if (item.type === "toolCall") {
				container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme, false), 0, 0));
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
	return container;
}

function collapsedResult(result: SingleResult, theme: Theme): Text {
	const icon = resultIcon(result, theme);
	let text = `${icon} ${theme.fg("toolTitle", theme.bold(result.agent))}`;
	if (result.step) text = `${theme.fg("muted", `step ${result.step} `)}` + text;
	if (isFailedResult(result) && result.stopReason) text += ` ${theme.fg("error", `[${result.stopReason}]`)}`;

	const displayItems = getDisplayItems(result.messages);
	if (isFailedResult(result) && result.errorMessage) {
		text += `\n${theme.fg("error", `Error: ${result.errorMessage}`)}`;
	} else if (displayItems.length === 0) {
		text += `\n${theme.fg("muted", result.exitCode === -1 ? "(running...)" : "(no output)")}`;
	} else {
		text += `\n${renderDisplayItems(displayItems, theme, COLLAPSED_ITEM_COUNT)}`;
		if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	}
	const usage = formatUsageStats(result.usage, result.model);
	if (usage) text += `\n${theme.fg("dim", usage)}`;
	return new Text(text, 0, 0);
}

function collapsedMulti(details: SubagentDetails, theme: Theme): Text {
	const results = details.results;
	const running = results.filter((r) => r.exitCode === -1).length;
	const failed = results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
	const succeeded = results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;

	const icon = running > 0 ? theme.fg("warning", "⏳") : failed > 0 ? theme.fg("warning", "◐") : theme.fg("success", "✓");
	const status =
		running > 0
			? `${succeeded + failed}/${results.length} done, ${running} running`
			: `${succeeded}/${results.length} ${details.mode === "chain" ? "steps" : "tasks"}`;
	let text = `${icon} ${theme.fg("toolTitle", theme.bold(`${details.mode} `))}${theme.fg("accent", status)}`;

	for (const result of results) {
		const displayItems = getDisplayItems(result.messages);
		const label = result.step ? `Step ${result.step}: ${result.agent}` : result.agent;
		text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", label)} ${resultIcon(result, theme)}`;
		if (displayItems.length === 0) {
			text += `\n${theme.fg("muted", result.exitCode === -1 ? "(running...)" : "(no output)")}`;
		} else {
			text += `\n${renderDisplayItems(displayItems, theme, 5)}`;
		}
	}
	if (running === 0) {
		const usage = formatUsageStats(aggregateUsage(results));
		if (usage) text += `\n\n${theme.fg("dim", `Total: ${usage}`)}`;
	}
	text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	return new Text(text, 0, 0);
}

function expandedMulti(details: SubagentDetails, theme: Theme): Container {
	const container = new Container();
	const results = details.results;
	const running = results.filter((r) => r.exitCode === -1).length;
	const failed = results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
	const succeeded = results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
	const icon = running > 0 ? theme.fg("warning", "⏳") : failed > 0 ? theme.fg("warning", "◐") : theme.fg("success", "✓");
	const status =
		running > 0
			? `${succeeded + failed}/${results.length} done, ${running} running`
			: `${succeeded}/${results.length} ${details.mode === "chain" ? "steps" : "tasks"}`;

	container.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold(`${details.mode} `))}${theme.fg("accent", status)}`, 0, 0));
	const mdTheme = getMarkdownTheme();
	for (const result of results) {
		const displayItems = getDisplayItems(result.messages);
		const finalOutput = getFinalOutput(result.messages);
		const label = result.step ? `─── Step ${result.step}: ` : "─── ";
		container.addChild(new Spacer(1));
		container.addChild(new Text(`${theme.fg("muted", label)}${theme.fg("accent", result.agent)} ${resultIcon(result, theme)}`, 0, 0));
		container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", result.task), 0, 0));
		for (const item of displayItems) {
			if (item.type === "toolCall") {
				container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme, false), 0, 0));
			}
		}
		if (finalOutput) {
			container.addChild(new Spacer(1));
			container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
		}
		const usage = formatUsageStats(result.usage, result.model);
		if (usage) container.addChild(new Text(theme.fg("dim", usage), 0, 0));
	}
	if (running === 0) {
		const usage = formatUsageStats(aggregateUsage(results));
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
	options: { expanded: boolean },
	theme: Theme,
): Component {
	const details = result.details as SubagentDetails | undefined;
	if (!details || details.results.length === 0) {
		const first = result.content[0];
		return new Text(first?.type === "text" ? first.text : "(no output)", 0, 0);
	}

	if (details.results.length === 1) {
		return options.expanded ? expandedResult(details.results[0], theme) : collapsedResult(details.results[0], theme);
	}
	return options.expanded ? expandedMulti(details, theme) : collapsedMulti(details, theme);
}

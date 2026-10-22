/**
 * Pure formatting helpers shared by the transcript renderers.
 *
 * The usage line keeps tokens, turns, model, and context — the facts the child
 * reported — and never money: a price needs a currency and a tariff, which the
 * bytefly footer owns for the whole session. See `usageLine` / `totalUsageLine`.
 */

import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatDuration, formatTokens, sanitizeLine, shortenPath } from "../../lib/format.ts";
import { USAGE_COUNTERS, zeroUsage } from "../../lib/usage.ts";
import type { BackgroundRun } from "./background.ts";
import type { UsageSource, UsageStats } from "./types.ts";

/** `2 turns` / `1 turn`, or "" when no turn was counted. */
function turnPart(turns: number | undefined): string {
	if (!turns) return "";
	return `${turns} turn${turns > 1 ? "s" : ""}`;
}

/** A prefix and a compact count, or "" when the counter is zero. */
function tokenPart(prefix: string, count: number | undefined): string {
	return count ? `${prefix}${formatTokens(count)}` : "";
}

/** `ctx:18.2k`, or "" when no context was reported. */
function contextPart(tokens: number | undefined): string {
	const count = tokens ?? 0;
	return count > 0 ? `ctx:${formatTokens(count)}` : "";
}

/** A space-separated usage line, omitting zero fields. */
export function formatUsageStats(usage: Partial<UsageStats>, model?: string): string {
	return [
		turnPart(usage.turns),
		tokenPart("↑", usage.input),
		tokenPart("↓", usage.output),
		tokenPart("R", usage.cacheRead),
		tokenPart("W", usage.cacheWrite),
		contextPart(usage.contextTokens),
		model ?? "",
	]
		.filter(Boolean)
		.join(" ");
}

/** Sum usage across results, for the chain/parallel totals line. */
export function aggregateUsage(results: readonly { usage: UsageStats }[]): Partial<UsageStats> {
	const counters = zeroUsage();
	let turns = 0;
	for (const { usage } of results) {
		for (const counter of USAGE_COUNTERS) counters[counter] += usage[counter];
		turns += usage.turns;
	}
	return { ...counters, turns };
}

/** "2 tool errors", "1 tool error", or "" when the run hit none. */
function toolErrorsLabel(count: number | undefined): string {
	if (!count) return "";
	return `${count} tool error${count > 1 ? "s" : ""}`;
}

/**
 * The one model every result ran, or undefined when they differ.
 *
 * A total may name a model only when the name is true of all of it: a batch whose
 * tasks pinned different models gets no label rather than one task's.
 */
function sharedModel(sources: readonly UsageSource[]): string | undefined {
	const models = new Set(sources.map((source) => source.model).filter((model): model is string => Boolean(model)));
	return models.size === 1 ? [...models][0] : undefined;
}

/** One result's usage line, with its tool-error count when it hit any. */
export function usageLine(source: UsageSource): string {
	return [formatUsageStats(source.usage, source.model), toolErrorsLabel(source.toolErrors)].filter(Boolean).join(" ");
}

/**
 * The `Total:` line for a multi run: summed counters, the shared model when there
 * is one, and summed tool errors. A total carries no `ctx:` — every child has its
 * own context window, so a sum of them would mean nothing.
 */
export function totalUsageLine(sources: readonly UsageSource[]): string {
	const usage = formatUsageStats(aggregateUsage(sources), sharedModel(sources));
	const errors = sources.reduce((sum, source) => sum + (source.toolErrors ?? 0), 0);
	const line = [usage, toolErrorsLabel(errors)].filter(Boolean).join(" ");
	return line ? `Total: ${line}` : "";
}

/** Display-width-aware truncation with a trailing ellipsis (keeps wide chars/surrogates intact). */
export function clip(value: string, max: number): string {
	// `truncateToWidth` emits ANSI resets; strip them since we colorize afterwards.
	return visibleWidth(value) > max ? stripTerminalSequences(truncateToWidth(value, max, "…")) : value;
}

const PATH_ELLIPSIS = "…/";

/** Clip a path, keeping its basename so the file stays identifiable. */
export function clipPath(value: string, max: number): string {
	if (visibleWidth(value) <= max) return value;
	const separator = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
	const base = separator >= 0 ? value.slice(separator + 1) : value;
	const headWidth = max - visibleWidth(base) - visibleWidth(PATH_ELLIPSIS);
	if (headWidth <= 0) return clip(value, max);
	const head = stripTerminalSequences(truncateToWidth(value.slice(0, separator + 1), headWidth, ""));
	return `${head}${PATH_ELLIPSIS}${base}`;
}

/** A compact, built-in-tool-style one-liner for a subagent tool call. */
export function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	theme: Theme,
	preview: boolean,
): string {
	const fg = theme.fg.bind(theme);
	// Defensive: a malformed tool-call part can carry a null/undefined `arguments`.
	const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;

	switch (toolName) {
		case "bash":
			return fg("muted", "$ ") + fg("toolOutput", clip(sanitizeLine(String(a.command ?? "…")), preview ? 60 : 200));
		case "read": {
			const rawPath = clipPath(shortenPath(sanitizeLine(String(a.file_path ?? a.path ?? "…"))), preview ? 60 : 200);
			const offset = a.offset as number | undefined;
			const limit = a.limit as number | undefined;
			let text = fg("accent", rawPath);
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				text += fg("warning", `:${start}${end ? `-${end}` : ""}`);
			}
			return fg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = clipPath(shortenPath(sanitizeLine(String(a.file_path ?? a.path ?? "…"))), preview ? 60 : 200);
			const content = String(a.content ?? "");
			const lines = content.split("\n").length;
			const text = fg("muted", "write ") + fg("accent", rawPath);
			return lines > 1 ? text + fg("dim", ` (${lines} lines)`) : text;
		}
		case "edit":
			return (
				fg("muted", "edit ") +
				fg("accent", clipPath(shortenPath(sanitizeLine(String(a.file_path ?? a.path ?? "…"))), preview ? 60 : 200)) +
				fg("dim", " (diff)")
			);
		case "ls":
			return (
				fg("muted", "ls ") +
				fg("accent", clipPath(shortenPath(sanitizeLine(String(a.path ?? "."))), preview ? 60 : 200))
			);
		case "find":
			return (
				fg("muted", "find ") +
				fg("accent", clip(sanitizeLine(String(a.pattern ?? "*")), preview ? 40 : 120)) +
				fg("dim", ` in ${clipPath(shortenPath(sanitizeLine(String(a.path ?? "."))), preview ? 40 : 120)}`)
			);
		case "grep":
			return (
				fg("muted", "grep ") +
				fg("accent", `/${clip(sanitizeLine(String(a.pattern ?? "")), preview ? 40 : 120)}/`) +
				fg("dim", ` in ${clipPath(shortenPath(sanitizeLine(String(a.path ?? "."))), preview ? 40 : 120)}`)
			);
		default: {
			const json = JSON.stringify(a);
			const text = clip(json, preview ? 50 : 200);
			return fg("accent", sanitizeLine(toolName)) + fg("dim", ` ${text}`);
		}
	}
}

/** The elapsed (or finished) duration of one background run. */
export function formatBackgroundDuration(run: BackgroundRun, now = Date.now()): string {
	const end = run.finishedAt ?? now;
	return formatDuration(Math.max(0, end - run.startedAt));
}

/** The headless `/agents` listing: a count, then one line per run. */
export function formatAgentsList(runs: readonly BackgroundRun[], now = Date.now()): string {
	if (runs.length === 0) return "No background subagents yet.";
	const running = runs.filter((run) => run.status === "running").length;
	const lines = [
		`${runs.length} background run${runs.length === 1 ? "" : "s"}${running ? ` · ${running} running` : ""}:`,
	];
	for (const run of runs) {
		const usage = run.usage ? formatUsageStats(run.usage) : "";
		lines.push(
			`  ${run.id} ${sanitizeLine(run.agent)} · ${sanitizeLine(run.task)} · ${run.status} · ${formatBackgroundDuration(run, now)}${usage ? ` · ${usage}` : ""}`,
		);
	}
	return lines.join("\n");
}

/**
 * Pure formatting helpers shared by the transcript renderers.
 */

import * as os from "node:os";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatTokens, sanitize as sanitizeWhitespace, stripControlChars } from "../../lib/format.ts";
import type { UsageStats } from "./types.ts";

/** One-line model text: strip control characters before collapsing whitespace. */
function sanitize(text: string): string {
	return sanitizeWhitespace(stripControlChars(text));
}

/** Dollar cost, keeping four decimals for the sub-cent amounts these runs produce. */
function formatCost(cost: number): string {
	if (cost >= 1) return `$${cost.toFixed(2)}`;
	if (cost >= 0.0001) return `$${cost.toFixed(4)}`;
	return `$${cost.toPrecision(2)}`;
}

/** A space-separated usage line, omitting zero fields. */
export function formatUsageStats(usage: Partial<UsageStats>, model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(formatCost(usage.cost));
	if (usage.contextTokens && usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

/** Sum usage across results, for the chain/parallel totals line. */
export function aggregateUsage(results: { usage: UsageStats }[]): Partial<UsageStats> {
	const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
	for (const { usage } of results) {
		total.input += usage.input;
		total.output += usage.output;
		total.cacheRead += usage.cacheRead;
		total.cacheWrite += usage.cacheWrite;
		total.cost += usage.cost;
		total.turns += usage.turns;
	}
	return total;
}

/** Replace the home directory prefix with `~`, matching a path boundary.
 *  Separators are normalized so a Windows home (`C:\\Users\\x`) still matches a
 *  path written with forward slashes, and the result reads uniformly in the UI. */
export function shortenPath(p: string): string {
	const normalize = (value: string): string => value.replace(/\\/g, "/");
	const home = normalize(os.homedir()).replace(/\/+$/, "");
	const path = normalize(p);
	if (path === home) return "~";
	return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
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
			return fg("muted", "$ ") + fg("toolOutput", clip(sanitize(String(a.command ?? "…")), preview ? 60 : 200));
		case "read": {
			const rawPath = clipPath(shortenPath(sanitize(String(a.file_path ?? a.path ?? "…"))), preview ? 60 : 200);
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
			const rawPath = clipPath(shortenPath(sanitize(String(a.file_path ?? a.path ?? "…"))), preview ? 60 : 200);
			const content = String(a.content ?? "");
			const lines = content.split("\n").length;
			const text = fg("muted", "write ") + fg("accent", rawPath);
			return lines > 1 ? text + fg("dim", ` (${lines} lines)`) : text;
		}
		case "edit":
			return (
				fg("muted", "edit ") +
				fg("accent", clipPath(shortenPath(sanitize(String(a.file_path ?? a.path ?? "…"))), preview ? 60 : 200)) +
				fg("dim", " (diff)")
			);
		case "ls":
			return (
				fg("muted", "ls ") + fg("accent", clipPath(shortenPath(sanitize(String(a.path ?? "."))), preview ? 60 : 200))
			);
		case "find":
			return (
				fg("muted", "find ") +
				fg("accent", clip(sanitize(String(a.pattern ?? "*")), preview ? 40 : 120)) +
				fg("dim", ` in ${clipPath(shortenPath(sanitize(String(a.path ?? "."))), preview ? 40 : 120)}`)
			);
		case "grep":
			return (
				fg("muted", "grep ") +
				fg("accent", `/${clip(sanitize(String(a.pattern ?? "")), preview ? 40 : 120)}/`) +
				fg("dim", ` in ${clipPath(shortenPath(sanitize(String(a.path ?? "."))), preview ? 40 : 120)}`)
			);
		default: {
			const json = JSON.stringify(a);
			const text = clip(json, preview ? 50 : 200);
			return fg("accent", toolName) + fg("dim", ` ${text}`);
		}
	}
}

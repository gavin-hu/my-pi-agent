/**
 * Pure formatting helpers shared by the transcript renderers.
 */

import * as os from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatTokens } from "../_shared/format.ts";
import type { UsageStats } from "./types.ts";

export { formatTokens };

/** Dollar cost, keeping four decimals for the sub-cent amounts these runs produce. */
export function formatCost(cost: number): string {
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

/** Replace the home directory prefix with `~`. */
export function shortenPath(p: string): string {
	const home = os.homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** A compact, built-in-tool-style one-liner for a subagent tool call. */
export function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	theme: Theme,
	preview: boolean,
): string {
	const fg = theme.fg.bind(theme);
	const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}...` : value);

	switch (toolName) {
		case "bash":
			return fg("muted", "$ ") + fg("toolOutput", clip(String(args.command ?? "..."), preview ? 60 : 200));
		case "read": {
			const rawPath = shortenPath(String(args.file_path ?? args.path ?? "..."));
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = fg("accent", rawPath);
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				text += fg("warning", `:${start}${end ? `-${end}` : ""}`);
			}
			return fg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = shortenPath(String(args.file_path ?? args.path ?? "..."));
			const content = String(args.content ?? "");
			const lines = content.split("\n").length;
			const text = fg("muted", "write ") + fg("accent", rawPath);
			return lines > 1 ? text + fg("dim", ` (${lines} lines)`) : text;
		}
		case "edit":
			return fg("muted", "edit ") + fg("accent", shortenPath(String(args.file_path ?? args.path ?? "..."))) + fg("dim", " (diff)");
		case "ls":
			return fg("muted", "ls ") + fg("accent", shortenPath(String(args.path ?? ".")));
		case "find":
			return (
				fg("muted", "find ") +
				fg("accent", String(args.pattern ?? "*")) +
				fg("dim", ` in ${shortenPath(String(args.path ?? "."))}`)
			);
		case "grep":
			return (
				fg("muted", "grep ") +
				fg("accent", `/${String(args.pattern ?? "")}/`) +
				fg("dim", ` in ${shortenPath(String(args.path ?? "."))}`)
			);
		default: {
			const json = JSON.stringify(args);
			const text = clip(json, preview ? 50 : 200);
			return fg("accent", toolName) + fg("dim", ` ${text}`);
		}
	}
}

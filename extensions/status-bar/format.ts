/**
 * Pure formatting helpers for the status bar.
 *
 * These never touch the terminal; they turn numbers and paths into the short
 * strings the bar shows. Styling happens in `lines.ts`.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { CONFIG } from "./config.ts";

export { formatTokens, sanitize } from "../../lib/format.ts";

/** Foreground theme tokens the bar uses. A subset of the theme's `ThemeColor`. */
export type FgToken =
	| "dim"
	| "muted"
	| "accent"
	| "success"
	| "error"
	| "warning"
	| "customMessageLabel"
	| ThinkingColor;

/** Theme tokens for the reasoning-effort indicator. */
export type ThinkingColor =
	| "thinkingOff"
	| "thinkingMinimal"
	| "thinkingLow"
	| "thinkingMedium"
	| "thinkingHigh"
	| "thinkingXhigh"
	| "thinkingMax";

/** US-dollar cost, always two decimals. A positive sub-cent amount never renders
 *  as `$0.00` — it shows `<$0.01`, so the number is never misleading. */
export function formatCost(cost: number): string {
	if (cost > 0 && cost < 0.01) return "<$0.01";
	return `$${cost.toFixed(2)}`;
}

/** Rounded percentage, or `?` when the value is unknown. */
export function formatPercent(percent: number | null): string {
	return percent === null ? "?" : `${Math.round(percent)}%`;
}

/** Backslashes to slashes, so Windows paths shorten and split like POSIX ones. */
function normalize(path: string): string {
	return path.replace(/\\/g, "/");
}

/** Replace the home prefix with `~`. */
function shortenHome(cwd: string, home: string | undefined): string {
	if (!home) return normalize(cwd);
	const target = normalize(cwd);
	const root = normalize(home).replace(/\/+$/, "");
	if (target === root) return "~";
	if (target.startsWith(`${root}/`)) return `~${target.slice(root.length)}`;
	return target;
}

/** The final path segment. */
function basename(path: string): string {
	const parts = normalize(path).split("/").filter(Boolean);
	return parts.at(-1) ?? path;
}

/**
 * Shorten a working directory.
 * `0` = full (`~/repo/project`), `1` = `~/project`, `2` = `project`.
 */
export function formatCwd(cwd: string, home: string | undefined, level: 0 | 1 | 2): string {
	const shortened = shortenHome(cwd, home);
	if (level === 0) return shortened;
	const base = basename(shortened);
	if (level === 2) return base;
	if (shortened === "~") return "~";
	if (shortened.startsWith("~/")) return `~/${base}`;
	const parts = shortened.split("/").filter(Boolean);
	return parts.length <= 2 ? shortened : `…/${parts.slice(-2).join("/")}`;
}

/** Filled/empty block counts for a percentage across `blocks` cells. */
export function computeGauge(percent: number | null, blocks: number): { filled: number; empty: number } {
	if (blocks <= 0) return { filled: 0, empty: 0 };
	if (percent === null) return { filled: 0, empty: blocks };
	const clamped = Math.max(0, Math.min(100, percent));
	// Floor so the bar is only full at 100%; force one block for any non-zero
	// usage so a small percentage is still visible.
	const filled = Math.max(clamped > 0 ? 1 : 0, Math.floor((clamped / 100) * blocks));
	return { filled, empty: blocks - filled };
}

/** Gauge color for a context percentage. Neutral until it crosses a threshold. */
export function contextColor(percent: number | null): FgToken {
	if (percent === null) return "muted";
	if (percent > CONFIG.thresholds.danger) return "error";
	if (percent > CONFIG.thresholds.warn) return "warning";
	return "muted";
}

const THINKING_TOKENS: Record<ThinkingLevel, ThinkingColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

/** Strip SGR color/style escapes, leaving only the visible characters. */
export function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Compact a status to its icon form for a narrow bar.
 *
 * An icon plus a label (`⋮ plan`) keeps only the icon. An icon plus a bare
 * count (`↺ 2`) is a badge: it keeps the count and drops the space (`↺2`),
 * because the number is the state. SGR color is stripped first — keeping the
 * opening escape without its reset would bleed color into the rest of the line.
 * Requiring exactly two tokens (rather than "the last token is numeric") keeps
 * a numeric label like `⋮ plan · 2024` from being mistaken for a count.
 */
export function compactStatus(status: string): string {
	const tokens = stripAnsi(status).trim().split(/\s+/).filter(Boolean);
	const icon = tokens[0] ?? "";
	return tokens.length === 2 && /^\d+$/.test(tokens[1]) ? `${icon}${tokens[1]}` : icon;
}

/**
 * Drop a status's trailing ` · detail` while keeping its SGR styling.
 *
 * The `plan-mode` chip carries the plan file name as detail (`⋮ plan · name`);
 * the bar shows only the mode. Matching `[^ESC]*` removes the visible suffix
 * without consuming the closing reset, so the chip's color stays balanced.
 */
export function dropStatusDetail(status: string): string {
	return status.replace(/ · [^\x1b]*/, "");
}

/** Truncate to `max` display columns, counting wide characters correctly. */
export function truncateLabel(label: string, max: number): string {
	return stripAnsi(truncateToWidth(label, max, "…"));
}

/** Theme token for a reasoning-effort level. Mirrors Pi's own mapping; the
 *  `thinkingOff` fallback only guards against an unknown runtime value. */
export function thinkingColor(level: ThinkingLevel): ThinkingColor {
	return THINKING_TOKENS[level] ?? "thinkingOff";
}

/**
 * Pure formatting helpers for the status bar.
 *
 * These never touch the terminal; they turn numbers and paths into the short
 * strings the bar shows. Styling happens in `lines.ts`.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import { CONFIG } from "./config.ts";

export { formatTokens, sanitize } from "../_shared/format.ts";

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

/** US-dollar cost. `compact` drops to one decimal place, but never rounds a
 *  positive sub-`$0.1` amount down to `$0.0`. */
export function formatCost(cost: number, compact = false): string {
	const decimals = compact && cost >= 0.1 ? 1 : 2;
	return `$${cost.toFixed(decimals)}`;
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
	const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
	const filled = Math.round((clamped / 100) * blocks);
	return { filled, empty: blocks - filled };
}

/** Gauge color for a context percentage. */
export function contextColor(percent: number | null): FgToken {
	if (percent === null) return "muted";
	if (percent > CONFIG.thresholds.danger) return "error";
	if (percent > CONFIG.thresholds.warn) return "warning";
	return "success";
}

const THINKING_TOKENS: Record<string, ThinkingColor> = {
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

/** Truncate to `max` display columns, counting wide characters correctly. */
export function truncateLabel(label: string, max: number): string {
	return stripAnsi(truncateToWidth(label, max, "…"));
}

/** Theme token for a reasoning-effort level. */
export function thinkingColor(level: string): ThinkingColor {
	return THINKING_TOKENS[level] ?? "thinkingMedium";
}

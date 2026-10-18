/**
 * Pure formatting helpers for the status bar.
 *
 * These never touch the terminal; they turn numbers and paths into the short
 * strings the bar shows. Styling happens in `lines.ts`.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { shortenPath } from "../../../../lib/format.ts";
import { gaugeRole } from "../../../../lib/tui/gauge.ts";
import type { TuiRole } from "../../../../lib/tui/tokens.ts";
import { CONFIG } from "../config.ts";
import { CURRENCY_SYMBOLS, DEFAULT_CURRENCY } from "../price/config.ts";
import type { Currency } from "../price/types.ts";

/** Theme tokens for the reasoning-effort indicator. */
export type ThinkingColor =
	| "thinkingOff"
	| "thinkingMinimal"
	| "thinkingLow"
	| "thinkingMedium"
	| "thinkingHigh"
	| "thinkingXhigh"
	| "thinkingMax";

/**
 * A cost in the configured currency, at its configured precision.
 *
 * A positive amount below one minor unit never renders as zero — it shows
 * `¥<0.01` — so a small cost is never reported as free.
 */
export function formatCost(cost: number, currency: Currency = DEFAULT_CURRENCY): string {
	const { decimals } = currency;
	const symbol = CURRENCY_SYMBOLS[currency.code];
	if (!Number.isFinite(cost) || cost <= 0) return `${symbol}${(0).toFixed(decimals)}`;
	const minimum = 10 ** -decimals;
	if (cost < minimum) return `${symbol}<${minimum.toFixed(decimals)}`;
	return `${symbol}${cost.toFixed(decimals)}`;
}

/** Rounded percentage, or `?` when the value is unknown. */
export function formatPercent(percent: number | null): string {
	return percent === null ? "?" : `${Math.round(percent)}%`;
}

/** The final path segment. */
function basename(path: string): string {
	const parts = path.split("/").filter(Boolean);
	return parts.at(-1) ?? path;
}

/**
 * Shorten a working directory.
 * `0` = full (`~/repo/project`), `1` = `~/project`, `2` = `project`.
 */
export function formatCwd(cwd: string, home: string | undefined, level: 0 | 1 | 2): string {
	// `shortenPath` normalizes separators and replaces the home prefix, so the
	// level-1/2 logic below only splits an already-normalized path.
	const shortened = shortenPath(cwd, home);
	if (level === 0) return shortened;
	const base = basename(shortened);
	if (level === 2) return base;
	if (shortened === "~") return "~";
	if (shortened.startsWith("~/")) return `~/${base}`;
	const parts = shortened.split("/").filter(Boolean);
	return parts.length <= 2 ? shortened : `…/${parts.slice(-2).join("/")}`;
}

/** The design role a context percentage is drawn in. Neutral until it crosses a threshold. */
export function contextRole(percent: number | null): TuiRole {
	return gaugeRole(percent, CONFIG.thresholds);
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

/** Truncate to `max` display columns, counting wide characters correctly. */
export function truncateLabel(label: string, max: number): string {
	return stripTerminalSequences(truncateToWidth(label, max, "…"));
}

/** Theme token for a reasoning-effort level. Mirrors Pi's own mapping; the
 *  `thinkingOff` fallback only guards against an unknown runtime value. */
export function thinkingColor(level: ThinkingLevel): ThinkingColor {
	return THINKING_TOKENS[level] ?? "thinkingOff";
}

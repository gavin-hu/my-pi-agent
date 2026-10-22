/**
 * The gauge: filled and empty blocks, and the tone they carry.
 *
 * One implementation for every bar in the package — the footer's context
 * meter, a plan's scroll position — so the block glyphs, the floor, and the
 * tone thresholds cannot drift between surfaces.
 *
 * Value-only: pure functions, theme passed in.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { GLYPHS } from "./glyphs.ts";
import { paint, type TuiRole } from "./tokens.ts";

/** The percentages at which a gauge changes tone. */
export interface GaugeThresholds {
	/** Above this (exclusive), the gauge warns. */
	warn: number;
	/** Above this (exclusive), the gauge is in error. */
	danger: number;
}

/** The package default: warn past 70%, error past 90%. */
export const DEFAULT_GAUGE_THRESHOLDS: GaugeThresholds = { warn: 70, danger: 90 };

/**
 * Filled and empty block counts for a percentage across `blocks` cells.
 *
 * The fill rounds to the nearest cell, so a bar sits no more than half a cell
 * away from the number printed beside it, and the last cell is kept for 100% so
 * a bar reads full only at a full value. Any non-zero usage still forces one
 * block, so a small percentage stays visible. A `null` percent (unknown) fills
 * nothing, leaving the caller to decide whether to draw the empty track; a known
 * `0` draws it.
 */
export function computeGauge(percent: number | null, blocks: number): { filled: number; empty: number } {
	if (blocks <= 0) return { filled: 0, empty: 0 };
	if (percent === null) return { filled: 0, empty: blocks };
	const clamped = Math.max(0, Math.min(100, percent));
	const nearest = Math.round((clamped / 100) * blocks);
	const capped = clamped < 100 ? Math.min(blocks - 1, nearest) : nearest;
	const filled = Math.max(clamped > 0 ? 1 : 0, capped);
	return { filled, empty: blocks - filled };
}

/** The role a context percentage is drawn in. Neutral until it crosses a threshold. */
export function gaugeRole(percent: number | null, thresholds: GaugeThresholds = DEFAULT_GAUGE_THRESHOLDS): TuiRole {
	if (percent === null) return "meta";
	if (percent > thresholds.danger) return "bad";
	if (percent > thresholds.warn) return "warn";
	return "meta";
}

/** A gauge bar's content. */
export interface GaugeBarOptions {
	/** The percentage, or `null` when it is unknown. */
	percent: number | null;
	/** Cells the track occupies. */
	blocks: number;
	/** Override the role instead of deriving it from the thresholds. */
	role?: TuiRole;
	/** Role for the empty track. Defaults to the filled role. */
	emptyRole?: TuiRole;
	thresholds?: GaugeThresholds;
}

/**
 * The colored bar, or `""` when the percentage is unknown.
 *
 * Unknown and zero stay distinct: a known `0%` still draws the empty track so
 * the column does not jump, while an unknown value draws nothing and leaves the
 * caller to print a muted `?` instead.
 */
export function gaugeBar(theme: Theme, options: GaugeBarOptions): string {
	if (options.percent === null) return "";
	const { filled, empty } = computeGauge(options.percent, options.blocks);
	const role = options.role ?? gaugeRole(options.percent, options.thresholds);
	const emptyRole = options.emptyRole ?? role;
	const track = filled > 0 ? paint(theme, role, GLYPHS.gaugeFull.repeat(filled)) : "";
	const rest = empty > 0 ? paint(theme, emptyRole, GLYPHS.gaugeEmpty.repeat(empty)) : "";
	return track + rest;
}

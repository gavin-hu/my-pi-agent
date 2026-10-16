/**
 * The transcript rail: the one left edge every non-prose transcript block hangs
 * from.
 *
 * A tool block, a shared notice, and a subagent's quoted output all draw the
 * same rail, so the transcript reads as one column instead of four indents. The
 * glyph is the turn rule's double-dash stroke rotated vertical (`RAIL`, from the
 * shared vocabulary), so the rail and the `╌` turn rule are one stroke family;
 * like every shared glyph it is East Asian neutral, so a CJK-width profile
 * cannot widen it and drift the block.
 *
 * Value-only: pure functions and constants, theme passed in.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS } from "./glyphs.ts";
import { paint, type TuiRole } from "./tokens.ts";

/** The transcript rail glyph: the turn rule's stroke, vertical. */
export const RAIL = GLYPHS.rail;

/** Columns between the rail and its content. */
export const RAIL_GAP = 1;

/** How a railed block reads at a glance. */
export type RailStatus = "info" | "ok" | "warn" | "bad";

/**
 * Status to design role: a rail is neutral by default, so a finished or merely
 * informational block draws no colour and only `warn` and `bad` stand out. A
 * surface whose `info` means *active* rather than *informational* brightens it
 * itself — a running tool call takes the accent (see `bytefly/block/config.ts`).
 */
export const RAIL_ROLES: Readonly<Record<RailStatus, TuiRole>> = {
	info: "info",
	ok: "faint",
	warn: "warn",
	bad: "bad",
};

/** How a railed block is placed. */
export interface RailOptions {
	/** Extra columns before the rail, e.g. a tool's `outputPad`. */
	indent?: number;
	/** Drop trailing lines with no visible content. Default true. */
	trimTrailing?: boolean;
}

/** Columns the rail prefix occupies at an indent. */
export function railWidth(indent = 0): number {
	return Math.max(0, Math.floor(indent)) + visibleWidth(RAIL) + RAIL_GAP;
}

/** The painted rail prefix: the indent, the rail, and the gap. */
export function railPrefix(theme: Theme, role: TuiRole, indent = 0): string {
	return `${" ".repeat(Math.max(0, Math.floor(indent)))}${paint(theme, role, RAIL)}${" ".repeat(RAIL_GAP)}`;
}

/** The rail indent, clamped so the rail prefix always fits the given width. */
function clampIndent(indent: number, width: number): number {
	return Math.max(0, Math.min(Math.floor(indent), Math.max(0, width - railWidth(0))));
}

/** An image-protocol line must pass through unprefixed, or the sequence corrupts. */
const IMAGE_LINE = /^\u001b(?:P|_G|\]1337;)/;

/**
 * Prefix each line of an already-rendered block with the rail, clipping each to
 * `width`. The block should be built at `width - railWidth(indent)` so nothing
 * is lost to the prefix; the clip is only a safety net. A line carrying an image
 * protocol sequence is passed through untouched, and trailing lines with no
 * visible content are dropped (by default) so an empty tail adds no bare rail.
 */
export function railBlockLines(
	body: readonly string[],
	role: TuiRole,
	theme: Theme,
	width: number,
	options: RailOptions = {},
): string[] {
	const w = Math.max(1, width);
	const prefix = railPrefix(theme, role, clampIndent(options.indent ?? 0, w));
	const lines: string[] = [];
	const blank: boolean[] = [];
	for (const line of body) {
		if (IMAGE_LINE.test(line)) {
			lines.push(line);
			blank.push(false);
			continue;
		}
		lines.push(truncateToWidth(`${prefix}${line}`, w, ""));
		blank.push(visibleWidth(line) === 0);
	}
	if (options.trimTrailing !== false) {
		while (blank.length > 0 && blank[blank.length - 1]) {
			lines.pop();
			blank.pop();
		}
	}
	return lines;
}

/**
 * Render `inner` at the width the rail prefix leaves, then rail it. An absent
 * `inner` renders nothing, so a tool with no output adds no bare rail.
 */
export function railLines(
	inner: Component | undefined,
	role: TuiRole,
	theme: Theme,
	width: number,
	options: RailOptions = {},
): string[] {
	if (!inner) return [];
	const w = Math.max(1, width);
	const indent = clampIndent(options.indent ?? 0, w);
	const innerWidth = Math.max(1, w - railWidth(indent));
	return railBlockLines(inner.render(innerWidth), role, theme, w, { ...options, indent });
}

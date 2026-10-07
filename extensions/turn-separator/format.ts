/**
 * Pure formatting for the turn-separator line.
 *
 * `separatorParts` decides the layout from a plain turn number and a column
 * count; `separatorLine` applies theme colors. Neither touches Pi state, so
 * both are cheap to unit test.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CONFIG } from "./config.ts";
import type { SeparatorParts } from "./types.ts";

/** ` turn N ` — the label printed in the middle of the line. */
export function separatorLabel(turn: number): string {
	const pad = " ".repeat(CONFIG.pad);
	return `${pad}${CONFIG.labelPrefix} ${turn}${pad}`;
}

/**
 * Split `width` columns into centered dashes and a label.
 *
 * When the label does not fit, the line degrades to a plain dashed rule so it
 * never overflows the transcript.
 */
export function separatorParts(turn: number, width: number): SeparatorParts {
	const target = Math.max(1, Math.floor(width));
	const label = separatorLabel(turn);
	const labelWidth = visibleWidth(label);

	if (labelWidth >= target) {
		return { left: CONFIG.glyph.repeat(target), label: "", right: "" };
	}

	const remaining = target - labelWidth;
	const left = Math.floor(remaining / 2);
	const right = remaining - left;
	return {
		left: CONFIG.glyph.repeat(left),
		label,
		right: CONFIG.glyph.repeat(right),
	};
}

/** One rendered line: colored dashes around a colored label. */
export function separatorLine(turn: number, width: number, theme: Theme): string[] {
	const { left, label, right } = separatorParts(turn, width);
	const dashes = (text: string) => (text ? theme.fg(CONFIG.dashColor, text) : "");
	return [dashes(left) + (label ? theme.fg(CONFIG.labelColor, label) : "") + dashes(right)];
}

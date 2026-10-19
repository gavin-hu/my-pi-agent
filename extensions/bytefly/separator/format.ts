/**
 * Pure formatting for bytefly's turn separator line.
 *
 * The line is a receipt for the settled run: the turn number, then as much of
 * the duration, the top-level tool count, and the outcome as the width can
 * carry. The centered `╌╌╌ turn N ╌╌╌` layout comes from the design system's
 * `centeredRule`, so this module only builds the label and picks its role; the
 * shared rule owns the centering and the dashes.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatDuration, formatToolCount } from "../../../lib/format.ts";
import { SEPARATORS } from "../../../lib/tui/glyphs.ts";
import { centeredRule } from "../../../lib/tui/rules.ts";
import type { TuiRole } from "../../../lib/tui/tokens.ts";
import { CONFIG } from "./config.ts";
import type { TurnSeparatorData } from "./types.ts";

/** Whether the label and `centeredRule`'s two pads leave room for a dash. */
function fits(label: string, width: number): boolean {
	return visibleWidth(label) + CONFIG.pad * 2 < width;
}

/**
 * The widest receipt that fits, shed one field at a time.
 *
 * The tool count goes first, then the duration; the outcome stays beside the
 * turn as long as it fits, because a failed or aborted run is the part the rule
 * should not hide. The turn number itself is never dropped here — a terminal
 * too narrow even for that falls back to `centeredRule`'s plain dashed rule.
 */
export function receiptLabel(data: TurnSeparatorData, width: number): string {
	const turn = `${CONFIG.labelPrefix} ${data.turn}`;
	const duration =
		data.durationMs !== undefined && data.durationMs >= CONFIG.minDurationMs
			? formatDuration(data.durationMs)
			: undefined;
	const tools = data.tools !== undefined && data.tools > 0 ? formatToolCount(data.tools) : undefined;
	const outcome = data.aborted
		? CONFIG.abortedLabel
		: data.failures !== undefined && data.failures > 0
			? `${CONFIG.failureGlyph}${data.failures}`
			: undefined;

	const steps: Array<Array<string | undefined>> = [
		[turn, duration, tools, outcome],
		[turn, duration, outcome],
		[turn, outcome],
		[turn],
	];
	for (const parts of steps) {
		const label = parts.filter((part): part is string => part !== undefined).join(SEPARATORS.item);
		if (fits(label, width)) return label;
	}
	return turn;
}

/** The label's role: an aborted turn warns, a failed tool is an error. */
export function receiptRole(data: TurnSeparatorData): TuiRole {
	if (data.aborted) return CONFIG.abortedRole;
	if (data.failures !== undefined && data.failures > 0) return CONFIG.failureRole;
	return CONFIG.labelRole;
}

/**
 * One rendered line: the centered turn rule, colored by role.
 *
 * `pad` is Pi's output pad. Pi gives an entry renderer no pad and adds its
 * component raw, so the rule insets itself symmetrically by that many columns,
 * keeping its left edge on the transcript's margin.
 */
export function separatorLine(data: TurnSeparatorData, width: number, theme: Theme, pad = 0): string[] {
	const w = Math.max(1, Math.floor(width));
	const inset = Math.max(0, Math.min(Math.floor(pad), Math.floor((w - 1) / 2)));
	const ruleWidth = Math.max(1, w - inset * 2);
	const line = centeredRule(theme, ruleWidth, receiptLabel(data, ruleWidth), {
		glyph: CONFIG.glyph,
		pad: CONFIG.pad,
		fillRole: CONFIG.dashRole,
		labelRole: receiptRole(data),
	});
	return [`${" ".repeat(inset)}${line}`];
}

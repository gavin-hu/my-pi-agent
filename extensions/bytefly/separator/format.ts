/**
 * Pure formatting for bytefly's turn separator line.
 *
 * The centered `╌╌╌ turn N ╌╌╌` layout comes from the design system's
 * `centeredRule`, so this module only names the turn; the shared rule owns the
 * centering, the degradation, and the colors.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { centeredRule } from "../../../lib/tui/rules.ts";
import { CONFIG } from "./config.ts";

/**
 * One rendered line: the centered turn rule, colored by role.
 *
 * `pad` is Pi's output pad. Pi gives an entry renderer no pad and adds its
 * component raw, so the rule insets itself symmetrically by that many columns,
 * keeping its left edge on the transcript's margin.
 */
export function separatorLine(turn: number, width: number, theme: Theme, pad = 0): string[] {
	const w = Math.max(1, Math.floor(width));
	const inset = Math.max(0, Math.min(Math.floor(pad), Math.floor((w - 1) / 2)));
	const line = centeredRule(theme, Math.max(1, w - inset * 2), `${CONFIG.labelPrefix} ${turn}`, {
		glyph: CONFIG.glyph,
		pad: CONFIG.pad,
		fillRole: CONFIG.dashRole,
		labelRole: CONFIG.labelRole,
	});
	return [`${" ".repeat(inset)}${line}`];
}

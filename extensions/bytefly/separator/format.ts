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

/** One rendered line: the centered turn rule, colored by role. */
export function separatorLine(turn: number, width: number, theme: Theme): string[] {
	return [
		centeredRule(theme, width, `${CONFIG.labelPrefix} ${turn}`, {
			glyph: CONFIG.glyph,
			pad: CONFIG.pad,
			fillRole: CONFIG.dashRole,
			labelRole: CONFIG.labelRole,
		}),
	];
}

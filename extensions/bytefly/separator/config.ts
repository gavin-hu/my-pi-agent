/**
 * Tuning for bytefly's turn separator.
 *
 * Edit this file to change how the line between completed turns looks. The
 * glyph and the colors are plain design-system roles, so the line follows the
 * active theme automatically.
 */

import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import type { TuiRole } from "../../../lib/tui/tokens.ts";

export const CONFIG = {
	/** Custom entry type. Changing it orphans separators recorded by an older build. */
	customType: "bytefly-separator",
	/** Repeatable glyph that fills each side of the label. */
	glyph: GLYPHS.turnRule,
	/** Word printed before the turn number. */
	labelPrefix: "turn",
	/** Spaces on each side of the label. */
	pad: 1,
	/** Role for the dashes. */
	dashRole: "ruleStrong",
	/** Role for the label. */
	labelRole: "meta",
} as const satisfies {
	customType: string;
	glyph: string;
	labelPrefix: string;
	pad: number;
	dashRole: TuiRole;
	labelRole: TuiRole;
};

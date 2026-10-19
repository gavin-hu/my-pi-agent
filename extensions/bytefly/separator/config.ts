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
	/** Role for a turn with a failed tool. */
	failureRole: "bad",
	/** Role for an aborted turn; escape is a warning, not an error. */
	abortedRole: "warn",
	/** Smallest run duration printed on the receipt; shorter turns keep the label quiet. */
	minDurationMs: 1000,
	/** Word appended when the run was aborted. */
	abortedLabel: "aborted",
	/** Glyph before a failed tool count. */
	failureGlyph: GLYPHS.cross,
} as const satisfies {
	customType: string;
	glyph: string;
	labelPrefix: string;
	pad: number;
	dashRole: TuiRole;
	labelRole: TuiRole;
	failureRole: TuiRole;
	abortedRole: TuiRole;
	minDurationMs: number;
	abortedLabel: string;
	failureGlyph: string;
};

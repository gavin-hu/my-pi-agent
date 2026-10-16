/**
 * Tuning for the user-message nameplate.
 *
 * Pi parses the transformed user message as Markdown and owns its colors, so
 * this surface has no roles: it only names the label and the rule.
 */

import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { RULE_GLYPH } from "../../../lib/tui/rules.ts";

export const MESSAGE_CONFIG = {
	/** Leading glyph on the label. */
	glyph: GLYPHS.prompt,
	/** The label word after the glyph. */
	label: "You",
	/** Repeatable glyph that fills the rule to the right margin. */
	ruleGlyph: RULE_GLYPH,
	/** Fewest rule columns worth drawing; below this the rule is dropped. */
	minRule: 3,
} as const;

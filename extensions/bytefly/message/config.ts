/**
 * Tuning for the user-message nameplate.
 *
 * Pi parses the transformed user message as Markdown and owns its colors, so
 * this surface has no roles: it only names the label and the rule.
 */

import { RULE_GLYPH } from "../../../lib/tui/rules.ts";

export const MESSAGE_CONFIG = {
	/** The label word in the heading. */
	label: "You",
	/** Repeatable glyph that fills the rule row. */
	ruleGlyph: RULE_GLYPH,
} as const;

/**
 * Tuning for the user-message prompt marker.
 *
 * Pi parses the transformed user message as Markdown and owns its colors, so
 * this surface has no roles: it only names the marker and the hang.
 */

import { GLYPHS } from "../../../lib/tui/glyphs.ts";

export const MESSAGE_CONFIG = {
	/** Leading glyph that marks a user turn. */
	glyph: GLYPHS.prompt,
	/** Prefix for a continuation line, so it hangs under the marker. */
	indent: "  ",
} as const;

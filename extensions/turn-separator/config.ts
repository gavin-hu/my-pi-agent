/**
 * Tuning for the turn-separator extension.
 *
 * Edit this file to change how the line between completed turns looks. The
 * glyphs and colors are plain theme tokens, so the line follows the active
 * theme automatically.
 */

export const CONFIG = {
	/** Custom entry type. Changing it orphans separators recorded by an older build. */
	customType: "turn-separator",
	/** Repeatable glyph that fills each side of the label. */
	glyph: "╌",
	/** Word printed before the turn number. */
	labelPrefix: "turn",
	/** Spaces on each side of the label. */
	pad: 1,
	/** Theme token for the dashes. */
	dashColor: "border",
	/** Theme token for the label. */
	labelColor: "muted",
} as const;

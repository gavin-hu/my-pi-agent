/**
 * Tuning for bytefly's header.
 *
 * The header reproduces Pi's built-in identity — the brand mark and the
 * version — but draws the mark from the active theme's tokens instead of the
 * fixed brand palette, so it follows the bytefly themes. The content is not
 * configurable; only the styling and the spacing below are.
 */

export const HEADER_CONFIG = {
	/** Which brand mark to draw: a `wordmark`, the two-line `logo`, or `none`. */
	mark: "wordmark",
	/** Print the running Pi version after the mark. */
	showVersion: true,
	/** Theme token for the mark's primary cells. */
	markColor: "accent",
	/** Theme token for the mark's accent cell, so the mark keeps its two tones. */
	markAccent: "warning",
	/** Theme token for the version string. */
	versionColor: "dim",
	/** Columns of left padding, matching Pi's built-in header indent. */
	padX: 1,
	/** Columns between the wordmark and the version on the same line. */
	gap: " ",
} as const;

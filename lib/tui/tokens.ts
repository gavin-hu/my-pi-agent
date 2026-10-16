/**
 * The Bytefly terminal design tokens: semantic roles mapped onto Pi's theme
 * colors.
 *
 * A component names a role (`title`, `meta`, `bad`) and the active theme
 * supplies the color, so switching themes re-skins every surface without a
 * component changing. The mapping is deliberately indirect: Pi's token set is
 * closed, so the kit only ever references it, never a literal color.
 *
 * Value-only: one frozen lookup table and pure helpers.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

/** A semantic role a surface can paint. */
export type TuiRole =
	/** The brand highlight: selection, focus, a model name. */
	| "accent"
	/** A screen, section, or panel title. */
	| "title"
	/** Primary body text. */
	| "label"
	/** Secondary text: counts, paths, summaries. */
	| "meta"
	/** Tertiary text and de-emphasis. */
	| "faint"
	/** A divider line. */
	| "rule"
	/** A heavier divider. */
	| "ruleStrong"
	/** Success. */
	| "ok"
	/** Warning. */
	| "warn"
	/** Error. */
	| "bad"
	/** Neutral notice. */
	| "info";

/** Role -> theme color. The single place the kit names a Pi token. */
export const TUI_TOKENS: Readonly<Record<TuiRole, ThemeColor>> = {
	accent: "accent",
	title: "accent",
	label: "text",
	meta: "muted",
	faint: "dim",
	rule: "borderMuted",
	ruleStrong: "border",
	ok: "success",
	warn: "warning",
	bad: "error",
	info: "muted",
};

/** Paint `text` in a role's color. */
export function paint(theme: Theme, role: TuiRole, text: string): string {
	return theme.fg(TUI_TOKENS[role], text);
}

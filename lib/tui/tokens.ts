/**
 * The Bytefly terminal design tokens: semantic roles mapped onto Pi's theme
 * colors.
 *
 * A component names a role (`title`, `meta`, `bad`) and the active theme
 * supplies the color, so switching themes re-skins every surface without a
 * component changing. The mapping is deliberately indirect: Pi's token set is
 * closed, so the kit only ever references it, never a literal color — and this
 * table is the one place it does, tool vocabulary included, so a remap here
 * reaches every surface the kit and the renderers draw.
 *
 * Value-only: one frozen lookup table and pure helpers.
 *
 * Two vocabularies live here and they do not mix: `ok`/`warn`/`bad` are verdicts —
 * they say how something *is* — and `hue1`…`hue5` are categories, which say only
 * "this is not those". A surface that shows hues keeps its verdicts to the places
 * that earn one, because a reader cannot tell a borrowed green from a judgement.
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
	| "info"
	/**
	 * A category hue: identity, never a verdict.
	 *
	 * Blue, purple, pink, green, and amber are the shipped palette's five colourful
	 * tokens, so a categorical surface reads as a chart. Green and amber are the same
	 * tokens `ok` and `warn` resolve to — that is the cost of Pi's closed token set —
	 * which is why a hue never appears in a slot that also carries a judgement.
	 */
	| "hue1"
	| "hue2"
	| "hue3"
	| "hue4"
	| "hue5"
	/** A tool call's own name: the transcript block's only accent. */
	| "toolTitle"
	/** A tool result's body text. */
	| "toolOutput";

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
	hue1: "accent",
	hue2: "mdListBullet",
	hue3: "mdCode",
	hue4: "success",
	hue5: "warning",
	toolTitle: "toolTitle",
	toolOutput: "toolOutput",
};

/** Paint `text` in a role's color. */
export function paint(theme: Theme, role: TuiRole, text: string): string {
	return theme.fg(TUI_TOKENS[role], text);
}

/**
 * The opening sequence for a role, without its reset. A frame that must repaint
 * a run in place — mid-line, where the surrounding text already carries the
 * closing reset — opens with this instead of wrapping a whole string.
 *
 * Derived from `paint` with a sentinel, so it tracks the theme's own escape
 * shape rather than assuming one.
 */
export function paintPrefix(theme: Theme, role: TuiRole): string {
	const marker = "\u0000";
	const wrapped = paint(theme, role, marker);
	return wrapped.slice(0, wrapped.indexOf(marker));
}

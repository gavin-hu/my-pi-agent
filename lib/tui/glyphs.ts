/**
 * Shared UI vocabulary: status-chip glyphs, separators, status keys, and the
 * expand-toggle keybinding id.
 *
 * The bytefly extension routes and re-renders the chips these extensions publish, so
 * the glyph and the `ctx.ui.setStatus` key must agree across both sides. Keep
 * the literals here and import them, never re-type them.
 */

import { keyText, type Theme } from "@earendil-works/pi-coding-agent";

/**
 * Leading glyphs for status chips and footer segments.
 *
 * Every glyph is a single terminal column in every profile: narrow or neutral
 * `East_Asian_Width`, never ambiguous, wide, or fullwidth, and never emoji. A
 * CJK-width profile renders an ambiguous glyph two columns wide, which drifts a
 * chip, a rail, or a footer row; `visibleWidth` cannot catch that (it counts an
 * ambiguous character as one column), so `lib/ui.test.ts` checks the width class
 * directly. Add a new glyph only after checking it against `EastAsianWidth.txt`.
 */
export const GLYPHS = {
	branch: "⎇",
	detached: "⚠",
	worktree: "⑂",
	rewind: "↺",
	snapshot: "⬥",
	plan: "⋮",
	jobsRunning: "▸",
	jobsFailure: "✗",
	stopped: "⊘",
	browse: "◉",
	wechat: "✆",
	gaugeFull: "▰",
	gaugeEmpty: "▱",
	turnRule: "╌",
	check: "✓",
	warn: "!",
	cross: "✕",
	disabled: "∅",
	half: "◒",
	pending: "◌",
	target: "⊚",
	killed: "⊝",
	unknown: "?",
	boxOn: "◼",
	boxOff: "◻",
	prev: "‹",
	next: "›",
} as const;

/** Columns before a transcript rail body glyph, shared by `goal` and `todo`. */
export const BODY_INDENT = 2;

/** Columns between a rail body glyph and its text. */
export const GLYPH_GAP = 1;

/** Padding used to join (`item`) or group (`group`) UI segments. */
export const SEPARATORS = {
	item: " · ",
	group: " │ ",
} as const;

/** `ctx.ui.setStatus` keys; one per extension that publishes a chip. */
export const STATUS_KEYS = {
	worktree: "worktree",
	planMode: "plan-mode",
	jobs: "jobs",
	jobsFailure: "jobs-failure",
	watch: "watch",
	watchMatches: "watch-matches",
	browse: "browse",
	rewind: "rewind",
	wechat: "wechat",
} as const;

/**
 * Keybinding id for Pi's built-in expand toggle (`ctrl+o` by default). Bind a
 * collapse hint to it through `keyText` rather than retyping the key, so a
 * rebound key is respected.
 */
export const EXPAND_KEYBINDING = "app.tools.expand";

/** The bound expand key, styled dim, or `""` when the binding is unknown. */
export function expandKey(theme: Theme): string {
	const key = keyText(EXPAND_KEYBINDING);
	return key ? theme.fg("dim", key) : "";
}

/**
 * Pi's key-hint format: the key dim, its description muted. An unbound key
 * (`""`) yields `""`, so a hint never prints a stray description.
 */
export function keyHintText(theme: Theme, key: string, description: string): string {
	return key ? theme.fg("dim", key) + theme.fg("muted", ` ${description}`) : "";
}

/**
 * The built-in-style expand affordance: a muted `(ctrl+o to expand)` with the
 * key in dim. Degrades to `(to expand)` when the binding is unknown.
 */
export function expandHint(theme: Theme): string {
	const hint = keyHintText(theme, keyText(EXPAND_KEYBINDING), "to expand)");
	return theme.fg("muted", "(") + (hint || theme.fg("muted", "to expand)"));
}

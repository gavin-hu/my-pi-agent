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
 * Leading glyphs for status chips, footer segments, and transcript rails.
 *
 * A glyph is a single terminal column: never wide, fullwidth, or emoji, which
 * are two columns in every profile. East-Asian *ambiguous* glyphs are allowed —
 * a CJK-width profile draws those two columns, so one costs a column there, but
 * the vocabulary is no longer limited to narrow/neutral characters. Add a glyph
 * only after checking its `East_Asian_Width` against `EastAsianWidth.txt`;
 * `lib/tui/glyphs.test.ts` bans wide, fullwidth, and emoji.
 */
export const GLYPHS = {
	branch: "⎇",
	detached: "⚠",
	worktree: "⑂",
	rewind: "↺",
	snapshot: "⬥",
	plan: "≡",
	jobsRunning: "▸",
	jobsFailure: "✗",
	stopped: "⊘",
	http: "◉",
	delegation: "↳",
	wechat: "✆",
	gaugeFull: "▰",
	gaugeEmpty: "▱",
	turnRule: "╌",
	divider: "╎",
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
	update: "↑",
	prompt: "❯",
} as const;

/** Columns between a rail body glyph and its text. */
export const GLYPH_GAP = 1;

/** Padding used to join UI segments. */
export const SEPARATORS = {
	item: " · ",
} as const;

/** `ctx.ui.setStatus` keys; one per extension that publishes a chip. */
export const STATUS_KEYS = {
	worktree: "worktree",
	planMode: "plan-mode",
	jobs: "jobs",
	jobsFailure: "jobs-failure",
	watch: "watch",
	watchMatches: "watch-matches",
	http: "http",
	rewind: "rewind",
	agents: "agents",
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

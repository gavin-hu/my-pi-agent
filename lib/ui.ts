/**
 * Shared UI vocabulary: status-chip glyphs, separators, status keys, and the
 * expand-toggle keybinding id.
 *
 * The status-bar routes and re-renders the chips these extensions publish, so
 * the glyph and the `ctx.ui.setStatus` key must agree across both sides. Keep
 * the literals here and import them, never re-type them.
 */

/** Leading glyphs for status chips and footer segments. */
export const GLYPHS = {
	branch: "⎇",
	detached: "⚠",
	worktree: "⑂",
	rewind: "↺",
	plan: "≡",
	jobsRunning: "▸",
	jobsFailure: "✗",
	serve: "⊙",
	gaugeFull: "▰",
	gaugeEmpty: "▱",
	turnRule: "╌",
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
	serve: "serve",
	rewind: "rewind",
} as const;

/**
 * Keybinding id for Pi's built-in expand toggle (`ctrl+o` by default). Bind a
 * collapse hint to it through `keyText` rather than retyping the key, so a
 * rebound key is respected.
 */
export const EXPAND_KEYBINDING = "app.tools.expand";

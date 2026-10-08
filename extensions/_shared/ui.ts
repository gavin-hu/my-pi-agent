/**
 * Shared UI vocabulary: status-chip glyphs, separators, and status keys.
 *
 * The status-bar routes and re-renders the chips these extensions publish, so
 * the glyph and the `ctx.ui.setStatus` key must agree across both sides. Keep
 * the literals here and import them, never re-type them.
 */

/** Leading glyphs for status chips and footer segments. */
export const GLYPHS = {
	branch: "⎇",
	detached: "⚠",
	worktree: "⧉",
	rewind: "↺",
	plan: "≡",
	jobsRunning: "▸",
	jobsFailure: "✗",
	gaugeFull: "▰",
	gaugeEmpty: "▱",
	turnRule: "╌",
} as const;

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
	rewind: "rewind",
} as const;

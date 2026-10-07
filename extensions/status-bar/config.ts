/**
 * Tuning for the two-line status bar.
 *
 * Edit this file to change the bar's content and layout. Weights live on the
 * segments themselves (see `lines.ts`); everything shared lives here.
 */

export const CONFIG = {
	/** Context percentage thresholds. */
	thresholds: { warn: 70, danger: 90 },
	/** Gauge glyphs, and the block counts the gauge steps down through. */
	gauge: { full: "▰", empty: "▱", widths: [10, 5, 3, 0] as const },
	/** Separators printed before grouped and other segments. */
	separators: { group: " │ ", item: " · " },
	icons: { branch: "⎇", detached: "⚠", worktree: "⧉", warning: "⚠" },
	/** Status key the worktree extension uses; routed to line 1's right zone. */
	worktreeStatusKey: "worktree",
	labels: { noModel: "no-model", detached: "detached" },
	/** Minimum gap kept between the left and right zones. */
	minGap: 2,
	/** Worktree label length before the compact form truncates it. */
	worktreeLabelMax: 14,
} as const;

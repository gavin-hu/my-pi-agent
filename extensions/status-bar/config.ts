/**
 * Tuning for the two-line status bar.
 *
 * Edit this file to change the bar's content and layout. Weights live on the
 * segments themselves (see `lines.ts`); everything shared lives here.
 */

import { GLYPHS, SEPARATORS, STATUS_KEYS } from "../../lib/ui.ts";

export const CONFIG = {
	/** Context percentage thresholds. */
	thresholds: { warn: 70, danger: 90 },
	/** Gauge glyphs, and the block counts the gauge steps down through. */
	gauge: { full: GLYPHS.gaugeFull, empty: GLYPHS.gaugeEmpty, widths: [10, 5, 3, 0] as const },
	/** Separators printed before grouped and other segments. */
	separators: { group: SEPARATORS.group, item: SEPARATORS.item },
	icons: { branch: GLYPHS.branch, detached: GLYPHS.detached, worktree: GLYPHS.worktree, serve: GLYPHS.serve },
	/** Status key the worktree extension uses; routed to line 1's right zone. */
	worktreeStatusKey: STATUS_KEYS.worktree,
	/** Status key the file-browser extension uses; routed to line 1's right zone. */
	serveStatusKey: STATUS_KEYS.serve,
	/** Status key whose ` · detail` suffix (the plan file name) is dropped. */
	planStatusKey: STATUS_KEYS.planMode,
	labels: { noModel: "no-model", detached: "detached" },
	/** Minimum gap kept between the left and right zones. */
	minGap: 2,
	/** Worktree label length before the compact form truncates it. */
	worktreeLabelMax: 14,
	/** Session-name length before the compact form truncates it. */
	sessionLabelMax: 14,
} as const;

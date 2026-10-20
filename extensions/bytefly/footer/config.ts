/**
 * Tuning for the two-line status bar.
 *
 * The bar's own content and layout: context thresholds, gauge widths,
 * separators, icons, status keys, and label limits. Segment weights
 * live on the segments themselves (see `../render/segments.ts`); the price
 * configuration is `bytefly.json`, read by `../price/config.ts`.
 */

import { GLYPHS, SEPARATORS, STATUS_KEYS } from "../../../lib/tui/glyphs.ts";

export const CONFIG = {
	/** Context percentage thresholds. */
	thresholds: { warn: 70, danger: 90 },
	/** The block counts the context gauge steps down through. */
	gauge: { widths: [10, 5, 3, 0] as const },
	/**
	 * Separators printed before grouped and other segments. The group divider is
	 * the footer's own solid `│`, not the shared `╎`: that glyph is the transcript
	 * rail (and `chrome.rail`'s default), and a status line is not a rail.
	 */
	separators: { group: " │ ", item: SEPARATORS.item },
	icons: {
		branch: GLYPHS.branch,
		detached: GLYPHS.detached,
		worktree: GLYPHS.worktree,
		browse: GLYPHS.browse,
		delegation: GLYPHS.delegation,
	},
	/** Status key the worktree extension uses; routed to line 1's right zone. */
	worktreeStatusKey: STATUS_KEYS.worktree,
	/** Status key the file-browse extension uses; routed to line 1's right zone. */
	browseStatusKey: STATUS_KEYS.browse,
	/** Status key whose ` · detail` suffix (the plan file name) is dropped. */
	planStatusKey: STATUS_KEYS.planMode,
	/** Status key treated as an alert: the one that sorts to the front of the slot. */
	jobsFailureStatusKey: STATUS_KEYS.jobsFailure,
	labels: { noModel: "no model", detached: "detached" },
	/** Minimum gap kept between the left and right zones. */
	minGap: 2,
	/** Worktree label length before the compact form truncates it. */
	worktreeLabelMax: 14,
	/** Session-name length before the compact form truncates it. */
	sessionLabelMax: 14,
} as const;

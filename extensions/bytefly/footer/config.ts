/**
 * Tuning for the two-line status bar.
 *
 * The bar's own content and layout: context thresholds, gauge widths,
 * separators, icons, status keys, and label limits. Segment weights
 * live on the segments themselves (see `../render/segments.ts`); the price
 * configuration is `bytefly.json`, read by `../price/config.ts`.
 */

import { GLYPHS, SEPARATORS, STATUS_KEYS } from "../../../lib/tui/glyphs.ts";

/**
 * Status keys that are alerts rather than modes, and so are never dropped.
 * A mode can be read again from the session; a failure cannot be re-derived once
 * its chip is off the bar. Annotated rather than inferred so the list can be read
 * against an arbitrary key from `getExtensionStatuses()`.
 */
const ALERT_STATUS_KEYS: readonly string[] = [STATUS_KEYS.jobsFailure];

export const CONFIG = {
	/** Context percentage thresholds. */
	thresholds: { warn: 70, danger: 90 },
	/** The block counts the context gauge steps down through. */
	gauge: { widths: [10, 5, 3, 0] as const },
	/** Separator printed before every segment but the first in its zone. */
	separators: { item: SEPARATORS.item },
	icons: {
		branch: GLYPHS.branch,
		detached: GLYPHS.detached,
		worktree: GLYPHS.worktree,
		http: GLYPHS.http,
		delegation: GLYPHS.delegation,
		autoMode: GLYPHS.autoMode,
	},
	/** Status key the worktree extension uses; routed to line 1's right zone. */
	worktreeStatusKey: STATUS_KEYS.worktree,
	/** Status key `serve` publishes the session's one page port under. */
	httpStatusKey: STATUS_KEYS.http,
	/** Status key whose chip is the plan state; the mode segment renders it. */
	planStatusKey: STATUS_KEYS.planMode,
	/**
	 * Status keys that are alerts rather than modes, and so are never dropped.
	 * A mode can be read again from the session; a failure cannot be re-derived
	 * once its chip is off the bar.
	 */
	alertStatusKeys: ALERT_STATUS_KEYS,
	labels: { noModel: "no model", detached: "detached", autoMode: "auto" },
	/** Minimum gap kept between the left and right zones. */
	minGap: 2,
	/** Worktree label length before the compact form truncates it. */
	worktreeLabelMax: 14,
	/** Session-name length before the compact form truncates it. */
	sessionLabelMax: 14,
} as const;

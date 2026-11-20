/**
 * The `code-review` section of the shared `bytefly.json`.
 *
 * The base a review compares against and the caps its page reads. A repository
 * whose default branch is not detectable names it once here; the numbers are
 * the same three `file-browse`'s diff page takes, under the same names, because
 * they mean the same thing.
 */

import { loadConfigSection } from "../../../lib/config.ts";
import { clampInteger, cleanString } from "../../../lib/json.ts";
import { MAX_BASE_LENGTH } from "../scope.ts";

export interface ReviewConfig {
	/** The ref a `base` review compares against; `""` detects one. */
	base: string;
	/** Unified context lines around each hunk. */
	diffContext: number;
	/** Rendered diff lines per file before truncation. */
	maxDiffLines: number;
	/** Changed files one page renders; the rest are counted, not drawn. */
	maxFiles: number;
}

/** Every key at its default: detect the base, three lines of context, 4 000 lines, 200 files. */
export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
	base: "",
	diffContext: 3,
	maxDiffLines: 4000,
	maxFiles: 200,
};

/** Validate and clamp a raw config object over the defaults. */
export function normalizeReviewConfig(
	raw: Record<string, unknown> | undefined,
	base: ReviewConfig = DEFAULT_REVIEW_CONFIG,
): ReviewConfig {
	if (!raw) return base;
	const configured = cleanString(raw.base, base.base);
	return {
		base: configured.slice(0, MAX_BASE_LENGTH),
		diffContext: clampInteger(raw.diffContext, base.diffContext, 0, 100),
		maxDiffLines: clampInteger(raw.maxDiffLines, base.maxDiffLines, 1, 1_000_000),
		maxFiles: clampInteger(raw.maxFiles, base.maxFiles, 1, 10_000),
	};
}

/** Load the effective config for a working directory. */
export function loadReviewConfig(cwd: string): ReviewConfig {
	return loadConfigSection(cwd, "code-review", DEFAULT_REVIEW_CONFIG, normalizeReviewConfig);
}

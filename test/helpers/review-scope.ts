/**
 * The comparison a preset names, for a suite that knows the default branch.
 *
 * `presetScope` answers `undefined` where no default resolved, which a case naming one can
 * never mean; every suite that opens a page needs the other branch of that answer, so the
 * assertion lives here once rather than in each file that opens one.
 */

import { presetScope, type ReviewPreset, type ReviewScope } from "../../extensions/code-review/scope.ts";

/** The comparison a preset names, against a resolved default branch — `main` unless a case says otherwise. */
export function comparisonOf(preset: ReviewPreset, defaultRef = "main"): ReviewScope {
	const named = presetScope(preset, defaultRef);
	if (named === undefined) throw new Error(`the ${preset} preset has no default to resolve`);
	return named;
}

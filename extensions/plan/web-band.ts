/**
 * The narrow band's one row: the view the reader is in, and both counts, in the short form a
 * 44px row has room for.
 *
 * These are a second **format** of facts the rail already draws, not a second source: the numbers
 * come from `data.steps` and the review's comments exactly as the rail's own rows do, and only the
 * words differ — `4/8` here against `4/8 ticked` there, a bare `3` against `1 open · 2 resolved`.
 * They stay short: a chip widened into the rail's sentence is a row that no longer fits a phone,
 * and the rail says the long version for the reader who opened the fold.
 *
 * #729 kept the switch outside the fold because a folded list took the filter with it, and a
 * filtered plan then read as a short one. #732 folds the switch and answers with this row, so the
 * view a reader is in is still named while the fold is shut.
 *
 * The functions read the document rather than taking it, so they cross into the client bundle as
 * one body each (`WEB_BAND_JS`) and a case can drive them with a fake one.
 */

import { pageSource } from "../../lib/format.ts";

/** The little of a node this module writes to, so a case can hand it a fake. */
export interface BandNode {
	textContent: string | null;
}

/** The document slice the band reads: three ids, which a page draws or does not. */
export interface BandDocument {
	getElementById(id: string): BandNode | null;
}

/** The step progress the island carries, which is what the rail's own meter shows. */
export interface BandSteps {
	done: number;
	total: number;
}

/** The document this function family writes through, as the page holds it. */
function bandDocument(): BandDocument {
	return (globalThis as unknown as { document: BandDocument }).document;
}

/**
 * The row's two counts. A plan with no Steps section has no progress to show, so that chip is
 * blank rather than `0/0` — the rail hides that row for the same reason.
 */
export function paintBandCounts(steps: BandSteps, comments: readonly { resolved?: boolean }[]): void {
	const doc = bandDocument();
	const counts = doc.getElementById("band-steps");
	if (counts) counts.textContent = steps.total === 0 ? "" : `${steps.done}/${steps.total}`;
	const notes = doc.getElementById("band-comments");
	if (notes) notes.textContent = String(comments.filter((note) => note.resolved !== true).length);
}

/** The row's view chip, in the words the switch itself uses. */
export function paintBandView(label: string | null): void {
	const view = bandDocument().getElementById("band-view");
	if (view && label) view.textContent = label;
}

/** The band's painters, as source for the client bundle. */
export const WEB_BAND_JS = [bandDocument, paintBandCounts, paintBandView].map(pageSource).join("\n\n");

/**
 * One file's whole text, as the review draws it.
 *
 * The diff shows the hunks; this shows the file they came from, so a line number a comment
 * names can be found here too. It is a reader: one number column instead of the diff's two,
 * wrapping by default, and the comparison it belongs to named in the footer — the view of the
 * review's own list, carrying a way back rather than a way into another page.
 *
 * It serves its own small client (`file-client.ts`) because the review page's does the work of
 * a page that writes — comments, the place, the stream — and none of that belongs here.
 */

import { renderDiffLines } from "../../../lib/diff/render.ts";
import type { DiffLine } from "../../../lib/diff/parse.ts";
import { escapeHtml } from "../../../lib/escape.ts";
import { detectLanguage } from "../../../lib/highlight.ts";
import { newHref } from "../links.ts";
import type { ReviewPreset, ReviewScope } from "../scope.ts";
import { renderReviewDocument } from "./page.ts";
import { wrapButton } from "./wrap.ts";

/** What the file view knows: the path, the text, and the comparison it came from. */
export interface ReviewFileView {
	/** The mount prefix, `/review`. */
	base: string;
	/** The comparison the review is showing, for the way back. */
	scope: ReviewScope;
	/** The preset naming that scope, so the way back lands on the same tab. */
	preset?: ReviewPreset;
	rel: string;
	/** The repository the file is read from, so the header says whose file this is. */
	repo: string;
	/** The comparison as the review page's footer names it. */
	comparison: string;
	lines: DiffLine[];
	/** The bytes are not text, so there is nothing to draw. */
	binary: boolean;
	/** The read hit its cap, so the file continues past the last line shown. */
	truncated: boolean;
	/** The file's whole line count; absent when the byte cap cut the read, so it is not known. */
	totalLines?: number;
}

/**
 * The one sentence a file's state owes, or none.
 *
 * Binary, truncated and empty are exclusive — a binary file has no lines, and an empty one is
 * never truncated — so the three are one switch rather than a list of notes that can stack.
 */
function noteFor(input: ReviewFileView): string {
	if (input.binary) return "A binary file; there is no text to show.";
	if (input.truncated) {
		// A read cut at the byte cap knows how much it showed and not how much there is.
		if (input.totalLines === undefined) {
			const shown = `${input.lines.length} line${input.lines.length === 1 ? "" : "s"}`;
			return `Showing the first ${shown} of a larger file.`;
		}
		const last = input.totalLines === 1 ? "line" : "lines";
		return `Showing the first ${input.lines.length} of ${input.totalLines} ${last}.`;
	}
	if (input.lines.length === 0) return "This file is empty.";
	return "";
}

/** The document, ready to serve. */
export function renderReviewFile(input: ReviewFileView): string {
	const { base, rel } = input;
	const note = noteFor(input);
	const body =
		input.binary || input.lines.length === 0
			? ""
			: `<pre class="bf-code bf-diff rv-diff rv-diff--file" data-path="${escapeHtml(rel)}" data-wrap="true" tabindex="0" aria-label="${escapeHtml(rel)}"><code>${renderDiffLines(input.lines, detectLanguage(rel), { gutter: "file" })}</code></pre>`;
	return renderReviewDocument({
		base,
		subject: rel,
		facts: escapeHtml(input.repo),
		footer: input.comparison,
		controls: `<div class="bf-app__actions">${wrapButton({ pressed: true })}</div>`,
		main: `  <p class="rv-side__back"><a class="bf-btn" id="rv-back" href="${escapeHtml(newHref(input.scope, input.preset))}">back to the review</a></p>
${note === "" ? "" : `  <p class="rv-file__note">${escapeHtml(note)}</p>\n`}  ${body}`,
	});
}

/**
 * One file's whole text, as the review draws it.
 *
 * The diff shows the hunks; this shows the file they came from, with the same gutter, so a
 * line number a comment names can be found here too. It is a view of the review's own list —
 * the router serves only a path that list names — and it carries a way back rather than a
 * way into another page.
 */

import { renderDiffLines } from "../../../lib/diff/render.ts";
import type { DiffLine } from "../../../lib/diff/parse.ts";
import { escapeHtml } from "../../../lib/escape.ts";
import { detectLanguage } from "../../../lib/highlight.ts";
import { appHead, baseAttribute, docHead, pageFooter, pageSheet, tabTitle } from "../../../lib/web/index.ts";
import { newHref } from "../links.ts";
import type { ReviewPreset, ReviewScope } from "../scope.ts";
import { REVIEW_CSS } from "./styles.ts";

/** What the file view knows: the path it shows, and the text the reader read. */
export interface ReviewFileView {
	/** The mount prefix, `/review`. */
	base: string;
	/** The comparison the review is showing, for the way back. */
	scope: ReviewScope;
	/** The preset naming that scope, so the way back lands on the same tab. */
	preset?: ReviewPreset;
	rel: string;
	lines: DiffLine[];
	/** The bytes are not text, so there is nothing to draw. */
	binary: boolean;
	/** The read hit its cap, so the file continues past the last line shown. */
	truncated: boolean;
}

/** The document, ready to serve. */
export function renderReviewFile(input: ReviewFileView): string {
	const { base, rel } = input;
	const notes = [
		input.binary ? '<p class="rv-file__note">A binary file; there is no text to show.</p>' : "",
		input.truncated
			? `<p class="rv-file__note">Showing the first ${input.lines.length} line${input.lines.length === 1 ? "" : "s"} of this file.</p>`
			: "",
	].filter((note) => note !== "");
	const body =
		input.binary || input.lines.length === 0
			? ""
			: `<pre class="bf-code bf-diff rv-diff" data-path="${escapeHtml(rel)}"><code>${renderDiffLines(input.lines, detectLanguage(rel))}</code></pre>`;
	return `<!doctype html>
<html lang="en"${baseAttribute(base)}>
<head>
${docHead({ title: tabTitle("review", rel), css: pageSheet(REVIEW_CSS), base })}
</head>
<body class="bf-app">
<h1 class="sr-only">review — ${escapeHtml(rel)}</h1>
${appHead({ product: "review", subject: { label: rel, title: rel }, facts: "" })}
<main class="bf-app__main" id="rv-main">
  <p class="rv-side__back"><a class="bf-btn" id="rv-back" href="${escapeHtml(newHref(input.scope, input.preset))}">back to the review</a></p>
${notes.length === 0 ? "" : `  ${notes.join("\n  ")}\n`}  ${body}
</main>
${pageFooter({ facts: "review" })}
</body>
</html>`;
}

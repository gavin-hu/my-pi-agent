/**
 * The plan text as a review shows and compares it (pure).
 *
 * Two needs pull in the same direction. A plan is model-authored text, so it is
 * neutralized before it reaches a terminal or a page; and a review has to compare
 * what it shows against what the previous review showed. Both start from the same
 * normalization — control characters stripped, tabs expanded, stored feedback
 * removed — so the digest a review writes and the digest a later review compares
 * cannot disagree about a plan that did not change.
 *
 * The baseline is one digest per heading section rather than the previous plan
 * text, so it can live in a session entry without copying the plan file into the
 * branch on every review.
 */

import { createHash } from "node:crypto";
import { stripControlChars } from "../../lib/format.ts";
import { displayFeedback, stripFeedback } from "./feedback.ts";
import { extractPlanSections } from "./steps.ts";

/** Spaces a tab expands to; the terminal's own tab stops are not width-modelled. */
const TAB_WIDTH = 4;

/** One heading section's identity and content digest. */
export interface SectionDigest {
	/** Plain heading text, or `""` for the content before the first heading. */
	title: string;
	/** SHA-256 of the section's normalized text, heading included. */
	digest: string;
}

/**
 * Replace control characters (including ESC and the C1 block) and expand tabs
 * so model-authored plan text cannot drive the terminal. Newlines are kept, so
 * callers can still render or split the text line by line.
 */
export function sanitizePlanText(text: string): string {
	return stripControlChars(text.replace(/\t/g, " ".repeat(TAB_WIDTH)));
}

/**
 * The text a review *shows*: terminal-safe, with stored comments kept in place
 * as readable quotes, so a reviewer sees what a teammate wrote.
 */
export function planDisplayText(content: string): string {
	return displayFeedback(sanitizePlanText(content));
}

/**
 * The text a review compares: terminal-safe, with tabs expanded and stored
 * feedback removed. A review comment a browser wrote into the file is a note to
 * the model, not an edit, so it never reads as a changed section.
 */
export function reviewText(content: string): string {
	return stripFeedback(sanitizePlanText(content));
}

/** Digest one section's text; the heading line is part of it. */
function digestOf(text: string): string {
	return createHash("sha256").update(text.trim()).digest("hex");
}

/**
 * A short, stable id for one plan text. The review page keys this tab's unsaved
 * draft on it, so a draft is restored for the plan it was written against and
 * dropped for a plan that changed underneath it.
 */
export function planDigest(text: string): string {
	return digestOf(text).slice(0, 12);
}

/** One digest per heading section, in document order, for a persisted baseline. */
export function sectionDigests(content: string): SectionDigest[] {
	return extractPlanSections(reviewText(content)).map((section) => ({
		title: section.title,
		digest: digestOf(section.text),
	}));
}

/** Whether two baselines describe the same content, section for section. */
export function sameSections(a: readonly SectionDigest[], b: readonly SectionDigest[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((section, index) => section.title === b[index].title && section.digest === b[index].digest);
}

/**
 * Per-section change flags for a second review: `boolean[]` aligned with
 * `extractPlanSections(reviewText(current))`, so duplicate headings are flagged
 * by occurrence rather than by title. An absent baseline flags nothing, which is
 * what a first review of a plan looks like; `stripFeedback` only ever drops
 * quote-marker lines, so the flags stay aligned with the sections a screen
 * renders from the same content.
 */
export function changedSections(baseline: readonly SectionDigest[] | undefined, current: string): boolean[] {
	const sections = extractPlanSections(reviewText(current));
	if (baseline === undefined) return sections.map(() => false);

	const before = new Map<string, string[]>();
	for (const section of baseline) {
		const digests = before.get(section.title);
		if (digests) digests.push(section.digest);
		else before.set(section.title, [section.digest]);
	}

	const seen = new Map<string, number>();
	return sections.map((section) => {
		const index = seen.get(section.title) ?? 0;
		seen.set(section.title, index + 1);
		const prior = before.get(section.title)?.[index];
		return prior === undefined || prior !== digestOf(section.text);
	});
}

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
import { extractPlanSections, sectionKeys, type PlanSection } from "./steps.ts";

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

/** One section of the text as it reads now, and whether it differs from the baseline. */
export interface SectionMark {
	/** The section, in the order the document lists it. */
	section: PlanSection;
	/** Whether its content differs from the baseline's section in the same place. */
	changed: boolean;
}

/**
 * Per-section change marks for a second review: every section of `current` with
 * whether its content differs from the baseline's section in the same place.
 *
 * The marks carry their sections, so a caller cannot pair the flags with a list it
 * parsed separately — the section list and its marks come out of one scan, in
 * document order. Duplicate headings are told apart by occurrence rather than by
 * title. An absent baseline marks nothing, which is what a first review of a plan
 * looks like; `stripFeedback` only ever drops quote-marker lines, so the marks stay
 * aligned with the sections a screen renders from the same content.
 */
export function changedSections(baseline: readonly SectionDigest[] | undefined, current: string): SectionMark[] {
	const sections = extractPlanSections(reviewText(current));
	if (baseline === undefined) return sections.map((section) => ({ section, changed: false }));

	// Same section across two reviews: `sectionKeys` tells a second `## Notes` from
	// the first, so a duplicate heading is never compared with the wrong digest.
	const before = new Map<string, string>();
	sectionKeys(baseline).forEach((key, at) => {
		const digest = baseline[at]?.digest;
		if (digest !== undefined) before.set(key, digest);
	});

	const keys = sectionKeys(sections);
	return sections.map((section, at) => {
		const prior = before.get(keys[at] ?? "");
		return { section, changed: prior === undefined || prior !== digestOf(section.text) };
	});
}

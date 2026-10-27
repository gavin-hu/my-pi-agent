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
import { extractSections, sectionKeys, type PlanSection } from "./sections.ts";
import { planBlocks } from "./blocks.ts";

/** Spaces a tab expands to; the terminal's own tab stops are not width-modelled. */
const TAB_WIDTH = 4;

/** One heading section's identity and content digest. */
export interface SectionDigest {
	/** Plain heading text, or `""` for the content before the first heading. */
	title: string;
	/** SHA-256 of the section's normalized text, heading included. */
	digest: string;
	/**
	 * Short digests of this section's content blocks, in order.
	 *
	 * Absent in a baseline a build before block marks wrote, which is why every reader
	 * treats it as optional: a section with no block digests marks nothing, and the page
	 * says it cannot compare at that depth rather than reading as "nothing changed".
	 */
	blocks?: string[];
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
 * A short, stable digest of one block's lines.
 *
 * Short because it is persisted once per content block in a session entry: eight hex
 * characters tell two blocks apart for the length of one review, which is all a change
 * mark needs, and keep a long plan's baseline small enough to sit in the branch.
 */
export function blockDigest(lines: readonly string[]): string {
	return digestOf(lines.join("\n")).slice(0, 8);
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
	return extractSections(reviewText(content)).map((section) => ({
		title: section.title,
		digest: digestOf(section.text),
		// Blank blocks are separators, not content: a plan that gained a blank line has not
		// changed, and a digest per separator would say it had.
		blocks: planBlocks(section.text)
			.filter((block) => block.kind !== "blank")
			.map((block) => blockDigest(block.lines)),
	}));
}

/** Where the blocks changed, in the document the page is about to render. */
export interface BlockChangeMarks {
	/** Absolute 0-based start lines of the blocks that are new or edited. */
	starts: number[];
	/** Content blocks each section no longer holds, keyed by the section's heading line. */
	removed: Record<number, number>;
	/**
	 * Whether the baseline carried block digests at all.
	 *
	 * False for a baseline a build before block marks wrote: section marks still mean
	 * something, block marks cannot, and the page says which instead of drawing nothing.
	 */
	compared: boolean;
}

/**
 * Where the blocks changed since the baseline, as the rendered document numbers them.
 *
 * The pages marks what it draws, so every line here is a line of `current`: a section's
 * blocks are numbered from its own heading, which is why the section's line is added
 * back. Sections are paired the way {@link changedSections} pairs them — by occurrence,
 * so a second `## Notes` is never compared with the first — and a section the baseline
 * never held is all new: every block in it marks, because adding or renaming a heading is
 * a refinement rather than a reason to refuse the comparison. Only a baseline section
 * written before block digests is beyond comparing at that depth, and it alone clears
 * `compared`.
 */
export function blockChangeMarks(baseline: readonly SectionDigest[] | undefined, current: string): BlockChangeMarks {
	const sections = extractSections(reviewText(current));
	if (baseline === undefined) return { starts: [], removed: {}, compared: false };
	const before = new Map<string, SectionDigest>();
	sectionKeys(baseline).forEach((key, at) => {
		const section = baseline[at];
		if (section !== undefined) before.set(key, section);
	});
	const starts: number[] = [];
	const removed: Record<number, number> = {};
	let compared = true;
	sectionKeys(sections).forEach((key, at) => {
		const section = sections[at];
		if (section === undefined) return;
		const prior = before.get(key);
		if (prior !== undefined && prior.blocks === undefined) {
			compared = false;
			return;
		}
		const mine = planBlocks(section.text).filter((block) => block.kind !== "blank");
		// An unheld section pairs with no blocks, so every block in it is new.
		const priorBlocks = new Set(prior?.blocks ?? []);
		for (const block of mine) {
			if (!priorBlocks.has(blockDigest(block.lines))) starts.push(section.line + block.start);
		}
		const shrunk = Math.max(0, (prior?.blocks?.length ?? 0) - mine.length);
		if (shrunk > 0) removed[section.line] = shrunk;
	});
	return { starts, removed, compared };
}

/** What one section's blocks look like against the baseline's. */
export interface BlockMarks {
	/** Indexes, among the section's content blocks, of the blocks that are new or edited. */
	changed: number[];
	/** How many content blocks the section no longer holds: the part it shrank by. */
	removed: number;
}

/**
 * Mark the blocks a section gained or edited since the baseline.
 *
 * Membership rather than position: a block is changed when its digest is not among the
 * baseline's, so an inserted step marks itself and leaves every block after it alone —
 * the index-by-index pairing a diff would use would mark the whole rest of the section.
 * A block that left cannot be drawn in place, so the section reports how much shorter it
 * has become instead — the shrinkage, not the set difference, so an edited block reads
 * as one change rather than as one removal beside one addition.
 *
 * An absent or blockless baseline marks nothing: a build before block marks wrote no
 * block digests, and claiming every block changed would be a worse lie than saying the
 * comparison cannot be made at that depth.
 */
export function changedBlocks(prior: readonly string[] | undefined, current: readonly string[]): BlockMarks {
	if (prior === undefined) return { changed: [], removed: 0 };
	const before = new Set(prior);
	return {
		changed: current.flatMap((digest, index) => (before.has(digest) ? [] : [index])),
		removed: Math.max(0, prior.length - current.length),
	};
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
	const sections = extractSections(reviewText(current));
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

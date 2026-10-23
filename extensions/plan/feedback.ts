/**
 * Inline review feedback for plan documents (pure).
 *
 * A comment is stored *in the plan file itself* as a blockquote on the line
 * directly after the block it refers to:
 *
 *     - [ ] Add a token bucket
 *     > [!REVIEW] @alice: what about the burst case?
 *     > [!REVIEW] name the ceiling too
 *
 * Placing it after a whole block (never inside a fence) keeps the markdown
 * valid and puts the comment next to the text the model must revise. The author
 * tag names whoever wrote it: a tagged marker belongs to that reviewer, and an
 * untagged one is the plan owner's. Every write is authored, so saving one
 * person's comments replaces only their own and leaves the rest in place.
 *
 * The anchor is a source line in the *stripped* plan, which is exactly what the
 * browser rendered. Saving is idempotent: {@link formatFeedback} strips the
 * writer's prior markers first, so repeated saves replace rather than
 * accumulate.
 */

import { sanitizeLine } from "../../lib/format.ts";
import { blockAt, planBlocks, type PlanBlock } from "./blocks.ts";

/** Marker that opens every stored feedback line. */
export const REVIEW_MARKER = "[!REVIEW]";

/** A single review comment, anchored to a source block. */
export interface PlanAnnotation {
	/** 0-based first source line of the anchored block, in the stripped plan. */
	anchor: number;
	/** Text the user selected, for display and the model summary; not stored. */
	quote?: string;
	/** The comment text. */
	comment: string;
	/** Who wrote it; `""`/absent is the plan owner, the only writer before sharing. */
	author?: string;
}

/** Most annotations one save may carry. */
export const MAX_ANNOTATIONS = 200;
/** Longest stored comment, after collapsing to one line. */
export const MAX_COMMENT_LENGTH = 2000;
/** Longest retained selection quote. */
export const MAX_QUOTE_LENGTH = 500;
/** Longest stored author name. */
export const MAX_AUTHOR_LENGTH = 40;

/** A stored feedback line, capturing its author and comment. */
const MARKER_LINE = /^\s*>\s*\[!REVIEW\]\s?(.*)$/;
/** The author prefix inside a marker body (`@alice: note`). */
const AUTHOR_PREFIX = /^@([^:]{1,40}):\s?(.*)$/;

/**
 * A reviewer name as it is stored and displayed: one sanitized line, no leading
 * `@`, no `:` (which would end the author early in the marker grammar), capped.
 * Anything unusable becomes `""`, the owner.
 */
export function normalizeAuthor(raw: unknown): string {
	if (typeof raw !== "string") return "";
	const text = sanitizeLine(raw)
		.replace(/^[\s@]+/, "")
		.replace(/:/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text.slice(0, MAX_AUTHOR_LENGTH).trim();
}

/** Source lines inside a fenced code block. A marker-looking line there is
 * documentation, not stored feedback, so it is never stripped or parsed. */
function fencedLines(plan: string): Set<number> {
	const fenced = new Set<number>();
	for (const block of planBlocks(plan)) {
		if (block.kind !== "code") continue;
		for (let line = block.start; line <= block.end; line++) fenced.add(line);
	}
	return fenced;
}

/** A stored marker, with the clean-plan line it followed and who wrote it. */
interface StoredMarker {
	/** Index in the clean plan of the line the marker followed; `-1` is the top. */
	at: number;
	comment: string;
	author: string;
}

/** The plan body without markers, plus the markers that were removed from it. */
function scanMarkers(plan: string): { clean: string; markers: StoredMarker[] } {
	const fenced = fencedLines(plan);
	const clean: string[] = [];
	const markers: StoredMarker[] = [];
	plan.split("\n").forEach((line, index) => {
		const match = fenced.has(index) ? null : MARKER_LINE.exec(line);
		if (!match) {
			clean.push(line);
			return;
		}
		const body = match[1].trim();
		if (body === "") return;
		const authored = AUTHOR_PREFIX.exec(body);
		const author = authored ? normalizeAuthor(authored[1]) : "";
		const comment = (authored ? authored[2] : body).trim();
		if (comment) markers.push({ at: clean.length - 1, comment, author });
	});
	return { clean: clean.join("\n"), markers };
}

/** One marker line in its stored form. */
function markerLine(author: string, comment: string): string {
	const body = sanitizeLine(comment);
	return author ? `> ${REVIEW_MARKER} @${author}: ${body}` : `> ${REVIEW_MARKER} ${body}`;
}

/** A marker waiting to be placed after clean-plan line `at`. */
interface Placed {
	at: number;
	line: string;
}

/**
 * Rebuild `clean` with `entries` inserted after the lines they name, grouping
 * several entries on one line in the order given. `-1` places at the top.
 */
function compose(clean: string, entries: Placed[]): string {
	if (entries.length === 0) return clean;
	if (clean === "") return entries.map((entry) => entry.line).join("\n");
	const buckets = new Map<number, string[]>();
	for (const entry of entries) {
		const bucket = buckets.get(entry.at) ?? [];
		bucket.push(entry.line);
		buckets.set(entry.at, bucket);
	}
	const lines = clean.split("\n");
	const out: string[] = [];
	const flush = (at: number): void => {
		const bucket = buckets.get(at);
		if (bucket) out.push(...bucket);
	};
	flush(-1);
	lines.forEach((line, index) => {
		out.push(line);
		flush(index);
	});
	// A marker placed past the last line still lands after it rather than nowhere.
	flush(lines.length);
	return out.join("\n");
}

/** Remove every stored feedback line, leaving the plan body as authored. */
export function stripFeedback(plan: string): string {
	return scanMarkers(plan).clean;
}

/**
 * Read stored feedback back. The anchor is the block ending just before each
 * marker in the stripped plan, so a comment keeps its place across reloads.
 */
export function parseFeedback(plan: string): PlanAnnotation[] {
	const { clean, markers } = scanMarkers(plan);
	if (markers.length === 0) return [];
	const blocks = planBlocks(clean);
	return markers.map((marker) => {
		const block = blockAt(blocks, marker.at);
		const annotation: PlanAnnotation = { anchor: block ? block.start : 0, comment: marker.comment };
		if (marker.author) annotation.author = marker.author;
		return annotation;
	});
}

/** Sanitized, non-empty comments with the anchor they land on. */
function storableComments(annotations: readonly PlanAnnotation[]): Array<{ anchor: number; comment: string }> {
	const items: Array<{ anchor: number; comment: string }> = [];
	for (const annotation of annotations) {
		const comment = sanitizeLine(annotation.comment);
		if (comment.length === 0 || comment.length > MAX_COMMENT_LENGTH) continue;
		items.push({ anchor: annotation.anchor, comment });
	}
	return items;
}

/**
 * Write `annotations` into `plan` as `options.author`'s comments, replacing the
 * markers that author already had and keeping every other writer's in place.
 * With no author, the writer is the plan owner — the untagged markers.
 */
export function formatFeedback(plan: string, annotations: PlanAnnotation[], options: { author?: string } = {}): string {
	const author = normalizeAuthor(options.author);
	const { clean, markers } = scanMarkers(plan);
	const kept = markers
		.filter((marker) => marker.author !== author)
		.map((marker) => ({ at: marker.at, line: markerLine(marker.author, marker.comment) }));
	const blocks = planBlocks(clean);
	const added = storableComments(annotations).map((item) => ({
		at: blockAt(blocks, item.anchor)?.end ?? -1,
		line: markerLine(author, item.comment),
	}));
	return compose(clean, [...kept, ...added]);
}

/** Text normalized the way an anchor match compares it. */
function matchingText(text: string): string {
	return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Block text normalized for matching a comment's anchor across a rewrite. */
function blockKey(block: PlanBlock): string {
	return matchingText(block.lines.join(" "));
}

/**
 * Carry the comments in `previous` onto `next`, the plan as it was rewritten.
 * Comments are not plan content, so `next` is stripped of any marker it carries
 * and every old marker is re-attached to the block whose text still matches; a
 * comment whose block was rewritten or removed is placed at the end rather than
 * dropped, where the review page shows it as unattached.
 */
export function carryFeedback(previous: string, next: string): string {
	const { clean: oldClean, markers } = scanMarkers(previous);
	const cleanNext = stripFeedback(next);
	if (markers.length === 0) return cleanNext;
	const oldBlocks = planBlocks(oldClean);
	const nextBlocks = planBlocks(cleanNext);
	const byKey = new Map<string, PlanBlock>();
	for (const block of nextBlocks) byKey.set(blockKey(block), block);
	const lastLine = cleanNext === "" ? -1 : cleanNext.split("\n").length - 1;
	const placed = markers.map((marker) => {
		const block = blockAt(oldBlocks, marker.at);
		const match = block ? byKey.get(blockKey(block)) : undefined;
		return {
			at: match ? match.end : lastLine,
			line: markerLine(marker.author, marker.comment),
		};
	});
	return compose(cleanNext, placed);
}

/**
 * Show stored comments in place, as the quotes they are: `@alice: …` for a
 * reviewer, `Review: …` for the owner. A terminal review, a dialog, and a phone
 * prompt read the plan through this, so a comment is never invisible just
 * because it is not the reader's own. Fenced code is opaque, as everywhere else.
 */
export function displayFeedback(plan: string): string {
	const fenced = fencedLines(plan);
	return plan
		.split("\n")
		.map((line, index) => {
			if (fenced.has(index)) return line;
			const match = MARKER_LINE.exec(line);
			if (!match) return line;
			const body = match[1].trim();
			if (body === "") return line;
			const authored = AUTHOR_PREFIX.exec(body);
			const author = authored ? normalizeAuthor(authored[1]) : "";
			const comment = (authored ? authored[2] : body).trim();
			if (!comment) return line;
			return author ? `> @${author}: ${comment}` : `> Review: ${comment}`;
		})
		.join("\n");
}

/** One-line quote for the model summary. */
function shortQuote(quote: string): string {
	const clean = sanitizeLine(quote);
	return clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean;
}

/** Numbered, model-facing text for the comments a review carried. */
export function feedbackSummary(annotations: PlanAnnotation[]): string {
	const items = annotations
		.map((annotation) => ({
			quote: annotation.quote ? shortQuote(annotation.quote) : "",
			// A name attached by a payload is data from another browser, not a label
			// the plan owner chose, so it is normalized like every other author.
			author: normalizeAuthor(annotation.author),
			comment: sanitizeLine(annotation.comment),
		}))
		.filter((item) => item.comment.length > 0);
	return items
		.map((item, index) => {
			const who = item.author ? `@${item.author}: ` : "";
			const where = item.quote ? `On "${item.quote}": ` : "";
			return `${index + 1}. ${who}${where}${item.comment}`;
		})
		.join("\n");
}

/**
 * Validate an untrusted annotations payload from a browser. Returns a
 * normalized list, or `undefined` when the shape is wrong. Empty comments are
 * dropped rather than rejected, so saving after deleting every comment clears
 * that writer's feedback.
 */
export function coerceAnnotations(value: unknown): PlanAnnotation[] | undefined {
	if (!Array.isArray(value) || value.length > MAX_ANNOTATIONS) return undefined;
	const annotations: PlanAnnotation[] = [];
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) return undefined;
		const record = entry as Record<string, unknown>;
		const anchor = record.anchor;
		if (typeof anchor !== "number" || !Number.isInteger(anchor) || anchor < 0) return undefined;
		if (typeof record.comment !== "string") return undefined;
		if (record.quote !== undefined && typeof record.quote !== "string") return undefined;
		if (record.author !== undefined && typeof record.author !== "string") return undefined;
		const comment = sanitizeLine(record.comment);
		if (comment.length > MAX_COMMENT_LENGTH) return undefined;
		if (comment.length === 0) continue;
		const quote = typeof record.quote === "string" ? sanitizeLine(record.quote).slice(0, MAX_QUOTE_LENGTH) : undefined;
		const author = normalizeAuthor(record.author);
		annotations.push({ anchor, comment, ...(quote ? { quote } : {}), ...(author ? { author } : {}) });
	}
	return annotations;
}

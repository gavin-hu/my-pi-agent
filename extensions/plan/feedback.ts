/**
 * Inline review feedback for plan documents (pure).
 *
 * A browser comment is stored *in the plan file itself* as a blockquote on the
 * line directly after the block it refers to:
 *
 *     - [ ] Add a token bucket
 *     > [!REVIEW] what about the burst case?
 *
 * Placing it after a whole block (never inside a fence) keeps the markdown
 * valid and puts the comment next to the text the model must revise. Saving is
 * idempotent: {@link formatFeedback} strips every prior marker first, so
 * repeated saves replace rather than accumulate. The anchor is a source line in
 * the *stripped* plan, which is exactly what the browser rendered.
 */

import { sanitizeLine } from "../../lib/format.ts";
import { blockAt, planBlocks } from "./blocks.ts";

/** Marker that opens every stored feedback line. */
export const REVIEW_MARKER = "[!REVIEW]";

/** A single browser comment, anchored to a source block. */
export interface PlanAnnotation {
	/** 0-based first source line of the anchored block, in the stripped plan. */
	anchor: number;
	/** Text the user selected, for display and the model summary; not stored. */
	quote?: string;
	/** The comment text. */
	comment: string;
}

/** Most annotations one save may carry. */
export const MAX_ANNOTATIONS = 200;
/** Longest stored comment, after collapsing to one line. */
export const MAX_COMMENT_LENGTH = 2000;
/** Longest retained selection quote. */
export const MAX_QUOTE_LENGTH = 500;

/** A stored feedback line, capturing its comment. */
const MARKER_LINE = /^\s*>\s*\[!REVIEW\]\s?(.*)$/;

/** Remove every stored feedback line, leaving the plan body as authored. */
export function stripFeedback(plan: string): string {
	return plan
		.split("\n")
		.filter((line) => !MARKER_LINE.test(line))
		.join("\n");
}

/**
 * Read stored feedback back. The anchor is the block ending just before each
 * marker in the stripped plan, so a comment keeps its place across reloads.
 */
export function parseFeedback(plan: string): PlanAnnotation[] {
	const clean: string[] = [];
	const markers: Array<{ after: number; comment: string }> = [];
	for (const line of plan.split("\n")) {
		const match = MARKER_LINE.exec(line);
		if (match) {
			const comment = match[1].trim();
			if (comment) markers.push({ after: clean.length, comment });
			continue;
		}
		clean.push(line);
	}
	if (markers.length === 0) return [];

	const blocks = planBlocks(clean.join("\n"));
	return markers.map(({ after, comment }) => {
		const anchorLine = after - 1;
		const block = anchorLine >= 0 ? blockAt(blocks, anchorLine) : undefined;
		return { anchor: block ? block.start : 0, comment };
	});
}

/**
 * Write `annotations` into `plan`, replacing any feedback already there. A
 * comment is placed after the whole anchored block, so a fenced code block is
 * never split and a list item gains its comment as a following quote.
 */
export function formatFeedback(plan: string, annotations: PlanAnnotation[]): string {
	const clean = stripFeedback(plan);
	const items = annotations
		.map((annotation) => ({ ...annotation, comment: sanitizeLine(annotation.comment) }))
		.filter((annotation) => annotation.comment.length > 0 && annotation.comment.length <= MAX_COMMENT_LENGTH);
	if (items.length === 0) return clean;
	if (clean === "") return items.map((annotation) => `> ${REVIEW_MARKER} ${annotation.comment}`).join("\n");

	const blocks = planBlocks(clean);
	// Insertion line -> marker lines, so several comments on one block stay grouped
	// in the order they were written.
	const buckets = new Map<number, string[]>();
	for (const annotation of items) {
		const block = blockAt(blocks, annotation.anchor);
		const at = block ? block.end : -1;
		const bucket = buckets.get(at) ?? [];
		bucket.push(`> ${REVIEW_MARKER} ${annotation.comment}`);
		buckets.set(at, bucket);
	}

	const out: string[] = [];
	const flush = (at: number): void => {
		const bucket = buckets.get(at);
		if (bucket) out.push(...bucket);
	};
	flush(-1);
	clean.split("\n").forEach((line, index) => {
		out.push(line);
		flush(index);
	});
	return out.join("\n");
}

/** One-line quote for the model summary. */
function shortQuote(quote: string): string {
	const clean = sanitizeLine(quote);
	return clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean;
}

/** Numbered, model-facing text for the comments a save carried. */
export function feedbackSummary(annotations: PlanAnnotation[]): string {
	const items = annotations
		.map((annotation) => ({
			quote: annotation.quote ? shortQuote(annotation.quote) : "",
			comment: sanitizeLine(annotation.comment),
		}))
		.filter((item) => item.comment.length > 0);
	return items
		.map((item, index) => `${index + 1}. ${item.quote ? `On "${item.quote}": ` : ""}${item.comment}`)
		.join("\n");
}

/**
 * Validate an untrusted annotations payload from the browser. Returns a
 * normalized list, or `undefined` when the shape is wrong. Empty comments are
 * dropped rather than rejected, so saving after deleting every comment clears
 * the file's feedback.
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
		const comment = sanitizeLine(record.comment);
		if (comment.length > MAX_COMMENT_LENGTH) return undefined;
		if (comment.length === 0) continue;
		const quote = typeof record.quote === "string" ? sanitizeLine(record.quote).slice(0, MAX_QUOTE_LENGTH) : undefined;
		annotations.push(quote ? { anchor, quote, comment } : { anchor, comment });
	}
	return annotations;
}

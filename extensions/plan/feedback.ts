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
import { blockAt, contentBlockAt, planBlocks, type PlanBlock } from "./blocks.ts";
import { extractPlanSections, sectionKeys } from "./steps.ts";

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

/** The name a reviewer write is stored under, or why it cannot be decided. */
export type AuthorClaim = { name: string } | { status: number; message: string };

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

/**
 * Decide the name a reviewer's write is stored under.
 *
 * A bound link keeps its name: a payload that signs a different one is a stale or
 * foreign page — a second tab of the same link, or a script — and re-signing it
 * would move markers that belong to whoever picked that name. Before the first
 * write the payload's own signature claims the name, unless another live link
 * already holds it. An unsigned post claims nothing, so it is refused rather than
 * binding a name to an accidental save.
 */
export function claimAuthor(
	input: { bound?: string; taken?: readonly string[] },
	annotations: readonly PlanAnnotation[],
): AuthorClaim {
	const signed = [...new Set(annotations.map((annotation) => normalizeAuthor(annotation.author)))].filter(Boolean);
	if (input.bound !== undefined) {
		if (signed.some((name) => name !== input.bound)) {
			return {
				status: 409,
				message: `This link posts as @${input.bound}; reload the page to comment as @${input.bound}.`,
			};
		}
		return { name: input.bound };
	}
	if (signed.length === 0) return { status: 400, message: "Choose a display name before commenting." };
	if (signed.length > 1) return { status: 409, message: "A post signs one name; reload the page and post again." };
	const name = signed[0] ?? "";
	if ((input.taken ?? []).includes(name)) {
		return { status: 400, message: "That name is already in use in this review." };
	}
	return { name };
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
 * A plan read the way the review reads it: its body, its blocks, and its
 * comments, out of one parse.
 */
export interface FeedbackRead {
	/** The plan body with every stored marker removed. */
	body: string;
	/** The body split into source-line blocks: the shape an anchor names. */
	blocks: PlanBlock[];
	/** The comments the markers carried, each anchored to a content block's start. */
	annotations: PlanAnnotation[];
}

/**
 * Read a plan once. An anchor is the start of the block the marker follows, so a
 * comment keeps its place across reloads — and it is always a block with
 * content, because the page renders no line for a blank one and so can never
 * attach a thread to it. A plan whose every line is blank has no such block: its
 * comments keep anchor `0` and the page lists them as unattached, which is the
 * truth there.
 */
export function readFeedback(plan: string): FeedbackRead {
	const { clean, markers } = scanMarkers(plan);
	const blocks = planBlocks(clean);
	const annotations = markers.map((marker) => {
		const annotation: PlanAnnotation = {
			anchor: contentBlockAt(blocks, marker.at)?.start ?? 0,
			comment: marker.comment,
		};
		if (marker.author) annotation.author = marker.author;
		return annotation;
	});
	return { body: clean, blocks, annotations };
}

/** The comments a plan carries, in the order they were written. */
export function parseFeedback(plan: string): PlanAnnotation[] {
	return readFeedback(plan).annotations;
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
		// A marker beside a block, never after a blank line: an anchor that names
		// blank space is written where the page can read it back as a thread.
		at: contentBlockAt(blocks, item.anchor)?.end ?? -1,
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
 * Words a block is compared by when it may merely have been reworded: lowercased,
 * with the list marker and task checkbox dropped. Every step of a `## Steps`
 * section would otherwise match every other one through its `- [ ]` alone.
 */
function blockWords(block: PlanBlock): Set<string> {
	const text = block.lines
		.join(" ")
		.toLowerCase()
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, " ")
		.replace(/\[[ x]\]/g, " ");
	return new Set(text.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== ""));
}

/** Share of the longer block's words that both blocks have. */
function sharedShare(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let shared = 0;
	for (const word of a) if (b.has(word)) shared += 1;
	return shared / Math.max(a.size, b.size);
}

/** Share of its words a block keeps, at or above which it is the same block reworded. */
const MATCH_SHARE = 0.5;

/**
 * Which block of `next` each block of `old` became, keeping both lists in
 * document order: the longest set of pairs whose wording overlaps enough to be one
 * block reworded. A block left without a pair is `-1` — deleted, or replaced by
 * text that shares nothing — which is the gap its comment belongs in.
 */
function alignBlocks(old: readonly PlanBlock[], next: readonly PlanBlock[]): number[] {
	const before = old.map(blockWords);
	const after = next.map(blockWords);
	const matches = before.map((words) => after.map((other) => (sharedShare(words, other) >= MATCH_SHARE ? 1 : 0)));
	// A longest common subsequence over the match grid, so a block that moved keeps
	// its own pairing instead of pulling the blocks around it along.
	const width = next.length + 1;
	const counts = new Array<number>((old.length + 1) * width).fill(0);
	for (let row = old.length - 1; row >= 0; row--) {
		for (let column = next.length - 1; column >= 0; column--) {
			const paired = matches[row][column] === 1 ? 1 + counts[(row + 1) * width + column + 1] : 0;
			counts[row * width + column] = Math.max(
				paired,
				counts[(row + 1) * width + column],
				counts[row * width + column + 1],
			);
		}
	}
	const aligned = new Array<number>(old.length).fill(-1);
	let row = 0;
	let column = 0;
	while (row < old.length && column < next.length) {
		if (matches[row][column] === 1 && counts[row * width + column] === 1 + counts[(row + 1) * width + column + 1]) {
			aligned[row] = column;
			row += 1;
			column += 1;
			continue;
		}
		if (counts[(row + 1) * width + column] >= counts[row * width + column + 1]) row += 1;
		else column += 1;
	}
	return aligned;
}

/**
 * A plan's heading sections, keyed by `sectionKeys`, each with the blocks a
 * comment can hang on and the last line of that content. Blank lines are left out
 * on purpose: a position among them would move when one is added or removed
 * above, and a reworded step would lose its comment to the next block. A section
 * with no content block ends at its own heading, which the page renders.
 */
function sectionIndex(plan: string, blocks: readonly PlanBlock[]): Map<string, { blocks: PlanBlock[]; end: number }> {
	const sections = extractPlanSections(plan);
	const index = new Map<string, { blocks: PlanBlock[]; end: number }>();
	const keys = sectionKeys(sections);
	keys.forEach((key, at) => index.set(key, { blocks: [], end: sections[at]?.line ?? 0 }));

	let position = 0;
	for (const block of blocks) {
		while (position + 1 < sections.length && (sections[position + 1]?.line ?? 0) <= block.start) position += 1;
		const key = keys[position];
		if (key === undefined) continue;
		const entry = index.get(key);
		if (!entry || block.kind === "blank") continue;
		entry.blocks.push(block);
		entry.end = block.end;
	}
	return index;
}

/**
 * Carry the comments in `previous` onto `next`, the plan as it was rewritten.
 * Comments are not plan content, so `next` is stripped of any marker it carries,
 * and every old one is re-attached by the strongest evidence that survives: the
 * block's text (per occurrence, so two identical steps keep their own comments),
 * then the block the alignment says it became when the wording changed, then the
 * gap it left between the blocks that survived, then the end of that section's
 * content. A comment whose section is gone too moves to the plan's last content
 * block, so the page keeps showing it under a block rather than listing it as
 * unattached; only a plan with no block at all leaves it in that list.
 */
export function carryFeedback(previous: string, next: string): string {
	const { clean: oldClean, markers } = scanMarkers(previous);
	const cleanNext = stripFeedback(next);
	if (markers.length === 0) return cleanNext;
	const oldBlocks = planBlocks(oldClean);
	const nextBlocks = planBlocks(cleanNext);
	// Identical blocks queue up in document order, so the first unclaimed one takes
	// the next comment rather than every comment landing on the last of them.
	const queues = new Map<string, PlanBlock[]>();
	for (const block of nextBlocks) {
		if (block.kind === "blank") continue;
		const key = blockKey(block);
		const queue = queues.get(key);
		if (queue) queue.push(block);
		else queues.set(key, [block]);
	}
	const oldSections = sectionIndex(oldClean, oldBlocks);
	const nextSections = sectionIndex(cleanNext, nextBlocks);
	const lastLine = cleanNext === "" ? -1 : cleanNext.split("\n").length - 1;
	// Where a comment goes when nothing about it survived: beside the plan's last
	// block, never after the blank line a trailing newline leaves.
	const tail = contentBlockAt(nextBlocks, lastLine)?.end ?? lastLine;

	/** One alignment per section, reused by every comment that lands in it. */
	const alignments = new Map<string, number[]>();

	/**
	 * Where a comment goes when its own block's text is gone: the block the alignment
	 * says it became, else the gap it left, else its section's end.
	 */
	const bySection = (block: PlanBlock): number | undefined => {
		for (const [key, before] of oldSections) {
			const index = before.blocks.indexOf(block);
			if (index < 0) continue;
			const after = nextSections.get(key);
			if (after === undefined) return undefined;
			let aligned = alignments.get(key);
			if (aligned === undefined) {
				aligned = alignBlocks(before.blocks, after.blocks);
				alignments.set(key, aligned);
			}
			const became = aligned[index];
			if (became >= 0) return after.blocks[became].end;
			// The gap it left is right after the block before its nearest surviving
			// successor: for the first block of a section, that is the heading.
			const successor = aligned.findIndex((at, from) => from > index && at >= 0);
			const gap = successor >= 0 ? after.blocks[aligned[successor] - 1] : undefined;
			return gap?.end ?? after.end;
		}
		return undefined;
	};

	const placed = markers.map((marker) => {
		const block = blockAt(oldBlocks, marker.at);
		const line = markerLine(marker.author, marker.comment);
		if (block === undefined) return { at: tail, line };
		if (block.kind !== "blank") {
			const match = queues.get(blockKey(block))?.shift();
			if (match !== undefined) return { at: match.end, line };
		}
		return { at: bySection(block) ?? tail, line };
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

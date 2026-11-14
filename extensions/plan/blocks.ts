/**
 * Block model for a plan document (pure).
 *
 * The browser review page anchors comments to source lines, and the plan's
 * existing section parser (`steps.ts`) only splits at headings, so it cannot
 * say where a paragraph or a step begins. This module is the one place that
 * maps markdown to source-line ranges: `planBlocks` splits a plan into
 * fence-aware blocks (heading, paragraph, list item, code, quote, blank), and
 * the renderer, the feedback codec, and their tests all agree on that shape.
 *
 * It is deliberately smaller than a CommonMark parser. Every block keeps its
 * raw source lines, so the caller can render or edit them exactly as written.
 * Fenced code is opaque: a `#` or `- ` inside a fence is never a heading or a
 * step.
 */

import {
	type MarkdownAlign,
	type MarkdownFence,
	type MarkdownListItem,
	scanBlocks,
	splitLines,
} from "../../lib/web/markdown-blocks.ts";
import { FENCE } from "./sections.ts";

/** How a block is rendered and grouped. */
export type PlanBlockKind = "heading" | "paragraph" | "list" | "code" | "quote" | "table" | "hr" | "blank";

/**
 * A contiguous, source-line-anchored chunk of a plan, with the structure its renderer reads.
 *
 * The scan already knows what a block is — a heading's level, a fence's body, a table's cells,
 * an item's marker — and the page used to parse all of it again out of `lines`. The fields are
 * per kind, and the island carries them, so the browser renderer draws instead of re-reading.
 */
export interface PlanBlock {
	/** 0-based first source line (inclusive). */
	start: number;
	/** 0-based last source line (inclusive). */
	end: number;
	kind: PlanBlockKind;
	/** The block's raw source lines, in order. */
	lines: string[];
	/** Heading level, 1-6. */
	level?: number;
	/** Heading text as written, inline markup included. */
	text?: string;
	/** A code block's fence marker. */
	fence?: MarkdownFence;
	/** A code block's source, its own delimiter lines removed. */
	body?: string[];
	/** A table's column alignment, from its delimiter row. */
	align?: MarkdownAlign[];
	/** A table's cells, header row first. */
	cells?: string[][];
	/** A list item's marker, indent and task box. */
	item?: MarkdownListItem;
	/** A quote's lines with their `>` markers removed. */
	quote?: string[];
}

/**
 * Whether a code block's fence is closed, so a line after the block is outside it.
 *
 * A fence opened and never closed runs to the end of the file, which makes "after the
 * block" a position inside the code: a comment placed there would be part of the code,
 * and the review codec would never read it back. Every other kind of block is open below.
 */
export function hasClosingFence(block: PlanBlock): boolean {
	if (block.kind !== "code") return true;
	const opener = block.lines[0]?.match(FENCE);
	const last = block.lines.length > 1 ? block.lines[block.lines.length - 1] : undefined;
	const closer = last === undefined ? null : last.match(FENCE);
	if (!opener || !closer) return false;
	const opened = opener[1];
	const closed = closer[1];
	return closed[0] === opened[0] && closed.length >= opened.length;
}

/**
 * Split `plan` into source-line-anchored blocks, on the kit's one scan
 * (`lib/web/markdown-blocks.ts`): this module is the plan's naming of it. A `fence` is
 * `code` here, and `start`/`end`/`lines` are the scan's, so a digest, an anchor or a
 * stored comment keeps meaning what it meant.
 */
export function planBlocks(plan: string): PlanBlock[] {
	if (plan === "") return [];
	return scanBlocks(splitLines(plan)).map((block) => ({
		start: block.start,
		end: block.end,
		// The plan passes no `htmlEnd`, so the scan cannot yield an `html` block: HTML is prose
		// here, and the cast names that guarantee rather than widening the plan's own kinds.
		kind: (block.kind === "fence" ? "code" : block.kind) as PlanBlockKind,
		lines: block.lines,
		...(block.level === undefined ? {} : { level: block.level }),
		...(block.text === undefined ? {} : { text: block.text }),
		...(block.fence === undefined ? {} : { fence: block.fence }),
		...(block.body === undefined ? {} : { body: block.body }),
		...(block.align === undefined ? {} : { align: block.align }),
		...(block.cells === undefined ? {} : { cells: block.cells }),
		...(block.item === undefined ? {} : { item: block.item }),
		...(block.quote === undefined ? {} : { quote: block.quote }),
	}));
}

/** The block containing source line `line`, or the nearest block before it. */
export function blockAt(blocks: readonly PlanBlock[], line: number): PlanBlock | undefined {
	let candidate: PlanBlock | undefined;
	for (const block of blocks) {
		if (block.start <= line && line <= block.end) return block;
		if (block.start > line) break;
		candidate = block;
	}
	return candidate;
}

/**
 * The nearest block with content at or before `line`, else the first one after
 * it: what a comment in blank space belongs to.
 *
 * A blank line is a block, so {@link blockAt} may name one, but a comment cannot
 * hang on nothing: the review page renders no line for a blank block, so an
 * anchor there is one it can never attach a thread to.
 */
export function contentBlockAt(blocks: readonly PlanBlock[], line: number): PlanBlock | undefined {
	let before: PlanBlock | undefined;
	for (const block of blocks) {
		const content = block.kind !== "blank";
		if (block.start <= line) {
			if (content) before = block;
			continue;
		}
		if (content) return before ?? block;
	}
	return before;
}

/** The source inside a fenced code block, without its opening and closing fence lines. */
export function codeBody(block: PlanBlock): string[] {
	if (block.kind !== "code") return block.lines.slice();
	const lines = block.lines.slice();
	if (lines.length > 0 && FENCE.test(lines[0])) lines.shift();
	if (lines.length > 0 && FENCE.test(lines[lines.length - 1])) lines.pop();
	return lines;
}

/** The info string after an opening fence (`ts` in ```` ```ts ````), or `""` for a plain line. */
export function fenceInfo(line: string): string {
	const match = line.match(/^ {0,3}(?:`{3,}|~{3,})\s*(.*?)\s*$/);
	return match ? match[1] : "";
}

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

/** How a block is rendered and grouped. */
export type PlanBlockKind = "heading" | "paragraph" | "list" | "code" | "quote" | "blank";

/** A contiguous, source-line-anchored chunk of a plan. */
export interface PlanBlock {
	/** 0-based first source line (inclusive). */
	start: number;
	/** 0-based last source line (inclusive). */
	end: number;
	kind: PlanBlockKind;
	/** The block's raw source lines, in order. */
	lines: string[];
}

/** ATX heading outside a fence. */
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
/** Code-fence opener or closer (backticks or tildes). */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** A list marker with its leading indentation and trailing gap. */
const LIST_ITEM = /^( *)([-*+]|\d+[.)])(\s+)/;
/** A blockquote line. */
const QUOTE = /^ {0,3}>/;

/** Leading spaces and tabs of a line, in columns (tab = 4). */
function indentOf(line: string): number {
	let width = 0;
	for (const char of line) {
		if (char === " ") width += 1;
		else if (char === "\t") width += 4;
		else break;
	}
	return width;
}

/** Index of the matching closing fence for a fence opened at `open`, or `lines.length`. */
function fenceEnd(lines: string[], open: number, marker: string, length: number): number {
	for (let i = open + 1; i < lines.length; i++) {
		const match = lines[i].match(FENCE);
		if (match && match[1][0] === marker && match[1].length >= length) return i;
	}
	return lines.length - 1;
}

/**
 * Split `plan` into source-line-anchored blocks. Line numbers are 0-based and
 * inclusive; `start`/`end` from one block never overlap the next.
 */
export function planBlocks(plan: string): PlanBlock[] {
	if (plan === "") return [];
	const lines = plan.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
	const blocks: PlanBlock[] = [];

	const push = (start: number, end: number, kind: PlanBlockKind): void => {
		blocks.push({ start, end, kind, lines: lines.slice(start, end + 1) });
	};

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];

		const fence = line.match(FENCE);
		if (fence) {
			const end = fenceEnd(lines, i, fence[1][0], fence[1].length);
			push(i, end, "code");
			i = end + 1;
			continue;
		}

		if (line.trim() === "") {
			push(i, i, "blank");
			i += 1;
			continue;
		}

		if (HEADING.test(line)) {
			push(i, i, "heading");
			i += 1;
			continue;
		}

		if (QUOTE.test(line)) {
			let end = i;
			while (end + 1 < lines.length && QUOTE.test(lines[end + 1])) end += 1;
			push(i, end, "quote");
			i = end + 1;
			continue;
		}

		const item = line.match(LIST_ITEM);
		if (item) {
			const indent = item[1].length;
			let end = i;
			// A block is the item plus any more-indented continuation lines. The
			// next item (any indent), a blank line, or an unindented line ends it.
			while (end + 1 < lines.length) {
				const next = lines[end + 1];
				if (next.trim() === "" || LIST_ITEM.test(next)) break;
				if (indentOf(next) <= indent) break;
				end += 1;
			}
			push(i, end, "list");
			i = end + 1;
			continue;
		}

		// Paragraph: consecutive lines that do not open another block.
		let end = i;
		while (end + 1 < lines.length) {
			const next = lines[end + 1];
			if (next.trim() === "" || FENCE.test(next) || HEADING.test(next) || QUOTE.test(next) || LIST_ITEM.test(next)) {
				break;
			}
			end += 1;
		}
		push(i, end, "paragraph");
		i = end + 1;
	}

	return blocks;
}

/** The block containing source line `line`, or the nearest block before it. */
export function blockAt(blocks: PlanBlock[], line: number): PlanBlock | undefined {
	let candidate: PlanBlock | undefined;
	for (const block of blocks) {
		if (block.start <= line && line <= block.end) return block;
		if (block.start > line) break;
		candidate = block;
	}
	return candidate;
}

/** A heading in a plan, for the review page's section outline. */
export interface PlanHeading {
	/** 0-based source line of the heading. */
	line: number;
	/** Heading level, 1-6. */
	level: number;
	/** Heading text with inline markdown removed. */
	text: string;
}

/** ATX heading with its captured level and raw text. */
const HEADING_PARTS = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Strip the inline markdown an outline label should not show. */
function headingText(raw: string): string {
	return raw
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

/** The plan's headings in order, for the outline. */
export function planHeadings(blocks: PlanBlock[]): PlanHeading[] {
	const headings: PlanHeading[] = [];
	for (const block of blocks) {
		if (block.kind !== "heading") continue;
		const match = block.lines[0]?.match(HEADING_PARTS);
		if (!match) continue;
		headings.push({ line: block.start, level: match[1].length, text: headingText(match[2]) });
	}
	return headings;
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

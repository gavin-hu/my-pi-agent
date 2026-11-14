/**
 * The block half of Markdown, scanned once for every served page.
 *
 * Two surfaces render a Markdown document — the review page (`extensions/plan`) and the
 * browse file view (`extensions/file-browse`) — and both need the same answer to "where
 * does a block begin and end". The review anchors a comment to a source line, so a block
 * is what a person points at; browse renders a README a file holds, so a block is what a
 * reader sees. This module is that one answer: it splits lines into source-anchored blocks
 * and carries the structure an emitter would otherwise parse a second time.
 *
 * The scan is deliberately smaller than CommonMark: the constructs a plan and a README
 * use, with every block keeping its raw source lines so a caller can render, edit or hash
 * exactly what it read. Blank lines are blocks of their own, because the review renders no
 * line for one but a comment placed in blank space resolves through them to the nearest
 * content block.
 *
 * The structure here is the *document's*, not a page's: a caller with a stricter rendering
 * rule decides that at its emitter. Browse refuses a table whose delimiter row does not
 * match its header, and runs one blockquote across a blank line where the scan keeps two
 * blocks — both decisions that would move an anchor if they lived in the scan.
 *
 * Value-only, and no page imports it the other way round: `lib/web` never reaches into an
 * extension.
 */

/**
 * A markdown heading outside a fence: up to three leading spaces, a space after the
 * hashes, and a closing hash run only when a space separates it, so `## C#` keeps its
 * title. Shared with the plan's section split, so the outline and the block scan read a
 * heading line the same way.
 */
export const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;

/**
 * A markdown code-fence opener or closer (backticks or tildes). A tab-indented fence is
 * prose for every reader, never code for one and prose for another.
 */
export const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A list marker with its leading indentation, its trailing gap and the item's own text. */
const LIST_ITEM = /^( *)([-*+]|\d+[.)])(\s+)(.*)$/;
/** A blockquote line. */
const QUOTE = /^ {0,3}>/;
/** A thematic break (`---`, `***`, `___`, spaced or not). */
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
/** A line that can be a table row: it carries at least one pipe. */
const TABLE_ROW = /\|/;
/** A GFM alignment row (`| --- | :--: |`), with or without edge pipes. */
const TABLE_DELIM = /^ {0,3}\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;

/** How a block is rendered; a caller maps a kind it spells differently (the plan calls a fence `code`). */
export type MarkdownBlockKind = "heading" | "paragraph" | "list" | "fence" | "quote" | "table" | "hr" | "blank";

/** A table column's alignment, from its delimiter cell. */
export type MarkdownAlign = "" | "left" | "center" | "right";

/** A list marker as the scan read it. */
export interface MarkdownListItem {
	/** A numeric marker (`1.` or `1)`). */
	ordered: boolean;
	/** Leading spaces before the marker, as written. */
	indent: number;
	/** The marker itself, e.g. `-` or `3.`. */
	marker: string;
	/** The item's first line with the marker removed. */
	content: string;
	/** A GFM task box, when the item opens with one. */
	task: "done" | "open" | null;
}

/** A fence's opening marker, kept so a caller can rewrite the block verbatim. */
export interface MarkdownFence {
	char: string;
	length: number;
	/** The info string after the run (`ts` in ```` ```ts ````), trimmed. */
	info: string;
}

/** A contiguous, source-line-anchored chunk of a document. */
export interface MarkdownBlock {
	kind: MarkdownBlockKind;
	/** 0-based first source line (inclusive). */
	start: number;
	/** 0-based last source line (inclusive). */
	end: number;
	/** The block's raw source lines, in order. */
	lines: string[];
	/** Heading level, 1-6. */
	level?: number;
	/** Heading text as written, inline markup included. */
	text?: string;
	/** The fence's marker, for a `fence` block. */
	fence?: MarkdownFence;
	/** The fence's body, its own delimiter lines removed. */
	body?: string[];
	/** One entry per column, from the delimiter row. */
	align?: MarkdownAlign[];
	/** Cell text per row, header first; pipes inside a cell are already unescaped. */
	cells?: string[][];
	/** The marker and the task box, for a `list` block. */
	item?: MarkdownListItem;
	/** The quoted lines with their `>` markers removed. */
	quote?: string[];
}

/** Split a document into lines the way every reader here does: CRLF, CR and LF all end a line. */
export function splitLines(source: string): string[] {
	return source.split(/\r\n|\r|\n/);
}

/** Leading spaces and tabs of a line, in columns (tab = 4). */
export function indentOf(line: string): number {
	let width = 0;
	for (const char of line) {
		if (char === " ") width += 1;
		else if (char === "\t") width += 4;
		else break;
	}
	return width;
}

/** Split one table row into cells, honouring `\|` and dropping the edge pipes. */
export function splitRow(line: string): string[] {
	let trimmed = line.trim();
	if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
	if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
	const cells: string[] = [];
	let current = "";
	for (let i = 0; i < trimmed.length; i++) {
		const char = trimmed[i];
		if (char === "\\" && trimmed[i + 1] === "|") {
			current += "|";
			i += 1;
			continue;
		}
		if (char === "|") {
			cells.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	cells.push(current.trim());
	return cells;
}

/** One column's alignment from its delimiter cell. */
function alignmentOf(cell: string): MarkdownAlign {
	const left = cell.startsWith(":");
	const right = cell.endsWith(":");
	if (left && right) return "center";
	if (right) return "right";
	if (left) return "left";
	return "";
}

/** Whether a table starts at `index`: a pipe row followed by an alignment row. */
function startsTable(lines: readonly string[], index: number): boolean {
	const header = lines[index];
	const delim = lines[index + 1];
	return (
		header !== undefined &&
		delim !== undefined &&
		TABLE_ROW.test(header) &&
		delim.includes("-") &&
		TABLE_DELIM.test(delim)
	);
}

/** Index of the matching closing fence for a fence opened at `open`, and whether one closed it. */
function fenceEnd(
	lines: readonly string[],
	open: number,
	marker: string,
	length: number,
): { end: number; closed: boolean } {
	for (let i = open + 1; i < lines.length; i++) {
		const match = lines[i].match(FENCE);
		if (match && match[1][0] === marker && match[1].length >= length) return { end: i, closed: true };
	}
	return { end: lines.length - 1, closed: false };
}

/** Whether a line opens a block that may interrupt a paragraph. */
function startsBlock(lines: readonly string[], index: number): boolean {
	const line = lines[index];
	return (
		line.trim() === "" ||
		FENCE.test(line) ||
		HEADING.test(line) ||
		QUOTE.test(line) ||
		LIST_ITEM.test(line) ||
		THEMATIC_BREAK.test(line) ||
		startsTable(lines, index)
	);
}

/**
 * Split `lines` into source-anchored blocks.
 *
 * Line numbers are 0-based and inclusive, and one block's `start`/`end` never overlap the
 * next. A list item is its own block, with its more-indented continuation lines kept with
 * it — the review points at a step, not at a list — and a caller that renders a list
 * groups a run of them at its emitter.
 */
export function scanBlocks(lines: readonly string[]): MarkdownBlock[] {
	const blocks: MarkdownBlock[] = [];
	const push = (start: number, end: number, block: Omit<MarkdownBlock, "start" | "end" | "lines">): void => {
		blocks.push({ start, end, lines: lines.slice(start, end + 1), ...block });
	};

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];

		const fence = line.match(FENCE);
		if (fence) {
			const char = fence[1][0];
			const length = fence[1].length;
			const { end, closed } = fenceEnd(lines, i, char, length);
			const raw = lines.slice(i, end + 1);
			const body = raw.slice(1, closed ? raw.length - 1 : raw.length);
			const info = line.slice(fence[0].length).trim();
			push(i, end, { kind: "fence", fence: { char, length, info }, body });
			i = end + 1;
			continue;
		}

		if (line.trim() === "") {
			push(i, i, { kind: "blank" });
			i += 1;
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			push(i, i, { kind: "heading", level: heading[1].length, text: heading[2] ?? "" });
			i += 1;
			continue;
		}

		if (QUOTE.test(line)) {
			let end = i;
			while (end + 1 < lines.length && QUOTE.test(lines[end + 1])) end += 1;
			const quote = lines.slice(i, end + 1).map((each) => each.replace(/^ {0,3}>\s?/, ""));
			push(i, end, { kind: "quote", quote });
			i = end + 1;
			continue;
		}

		// A list marker wins over a pipe, so `- | a | b |` stays an item instead of the
		// first cell of a table whose header is a bullet.
		const item = line.match(LIST_ITEM);
		if (item) {
			const indent = item[1].length;
			let end = i;
			while (end + 1 < lines.length) {
				const next = lines[end + 1];
				if (next.trim() === "" || LIST_ITEM.test(next)) break;
				if (indentOf(next) <= indent) break;
				end += 1;
			}
			const box = /^\[([ xX])\]\s*(.*)$/.exec(item[4]);
			const task: MarkdownListItem["task"] = box === null ? null : box[1].toLowerCase() === "x" ? "done" : "open";
			push(i, end, {
				kind: "list",
				item: {
					ordered: /\d/.test(item[2]),
					indent,
					marker: item[2],
					content: box === null ? item[4] : box[2],
					task,
				},
			});
			i = end + 1;
			continue;
		}

		if (startsTable(lines, i)) {
			let end = i + 1;
			while (end + 1 < lines.length && lines[end + 1].trim() !== "" && TABLE_ROW.test(lines[end + 1])) end += 1;
			const rows = lines.slice(i, end + 1).map(splitRow);
			const align = (rows[1] ?? []).map(alignmentOf);
			push(i, end, { kind: "table", align, cells: [rows[0] ?? [], ...rows.slice(2)] });
			i = end + 1;
			continue;
		}

		if (THEMATIC_BREAK.test(line)) {
			push(i, i, { kind: "hr" });
			i += 1;
			continue;
		}

		let end = i;
		while (end + 1 < lines.length && !startsBlock(lines, end + 1)) end += 1;
		push(i, end, { kind: "paragraph" });
		i = end + 1;
	}

	return blocks;
}

/** Scan a document: {@link splitLines} first, then {@link scanBlocks}. */
export function scanDocument(source: string): MarkdownBlock[] {
	return scanBlocks(splitLines(source));
}

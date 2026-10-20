/**
 * The transcript indent: how a non-prose block sits under its headline.
 *
 * A tool block, a shared notice, and a subagent's quoted output all hang from one
 * left edge. A block may lead with a headline (a tool's own call line) at the
 * outer indent; the body sits `BODY_INDENT` further in, directly under it with no
 * separator line, which is what keeps a tool block compact. The body's first
 * indent column may instead carry a rail glyph, passed in pre-painted by the
 * caller so this module stays value-only.
 *
 * Value-only: pure functions and constants, no theme.
 */

import { type Component, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Columns the body sits in beyond a block's outer indent. */
export const BODY_INDENT = 2;

/** How an indented block is placed. */
export interface IndentOptions {
	/** Columns the body is indented; a headline sits `BODY_INDENT` to its left. */
	indent?: number;
	/**
	 * A pre-painted, one-column rail glyph for the body's first indent column; the
	 * rest of the indent stays spaces. Ignored below `BODY_INDENT`, where there is
	 * no column to spare. Default: no rail.
	 */
	rail?: string;
	/**
	 * Start the rail after the headline's continuation: keep the leading run of
	 * non-blank body lines plain-indented, up to the first blank line. Set when the
	 * headline degenerated to the bare subject name (a tool's call line whose path
	 * moved onto the body), so the rail begins with the result instead of the
	 * wrapped call. Ignored without a rail. Default false.
	 */
	railAfterCall?: boolean;
	/** Drop leading lines with no visible content. Default false. */
	trimLeading?: boolean;
	/** Drop trailing lines with no visible content. Default true. */
	trimTrailing?: boolean;
	/**
	 * Lead with the first non-blank line as the block's headline, at
	 * `indent - BODY_INDENT`, with the body immediately after it. Default false.
	 */
	headline?: boolean;
	/**
	 * Suffix appended when a body line is clipped. Default empty: a body is clipped
	 * silently. The headline always clips with `…`. A notice sets `…` so a
	 * truncated row reads as truncated.
	 */
	bodyClip?: string;
}

/**
 * A line with no visible text. Tested after stripping terminal sequences, so a
 * line that is only spaces carrying a background (a `Box`'s own padding) counts
 * as blank rather than as content.
 */
export function isBlank(line: string): boolean {
	return stripTerminalSequences(line).trim().length === 0;
}

/** An image-protocol line must pass through unprefixed, or the sequence corrupts. */
const IMAGE_LINE = /^\u001b(?:P|_G|\]1337;)/;

/** The body indent, clamped so the prefix always leaves at least one column. */
function clampIndent(indent: number, width: number): number {
	return Math.max(0, Math.min(Math.floor(indent), Math.max(0, width - 1)));
}

/**
 * The body prefix: the rail glyph in the indent's first body column, or plain
 * spaces. The glyph must be one visible column, so the prefix is exactly `indent`
 * columns wide; the gap after it is the remaining `BODY_INDENT - 1`.
 */
function bodyPrefix(indent: number, rail: string | undefined): string {
	if (!rail || indent < BODY_INDENT) return " ".repeat(indent);
	const base = Math.max(0, indent - BODY_INDENT);
	return `${" ".repeat(base)}${rail}${" ".repeat(indent - base - 1)}`;
}

/**
 * A source line with no visible text; an image sequence is never blank. Tested
 * on the block's own line, not the placed one, so a rail glyph does not make an
 * empty body line read as content.
 */
function isBlankBody(line: string): boolean {
	return !IMAGE_LINE.test(line) && isBlank(line);
}

/**
 * Whether a placed line already fits its width.
 *
 * A tab expands to three columns, so a line carrying one always needs measuring.
 * Otherwise a string no longer than the width cannot be wider — painted text only
 * inflates `length` — so only a longer one is measured, which is worth doing
 * because `visibleWidth` falls back to grapheme segmentation for the non-ASCII
 * glyphs a transcript uses.
 */
function fitsWidth(placed: string, width: number): boolean {
	if (placed.includes("\t")) return visibleWidth(placed) <= width;
	return placed.length <= width || visibleWidth(placed) <= width;
}

/**
 * Place a line behind `prefix`, clipped to `width`.
 *
 * `truncateToWidth` measures and rebuilds the whole line on every call, and
 * placing runs per line, so a line that already fits is a plain concat instead.
 */
function place(prefix: string, line: string, width: number, clip: string): string {
	const placed = `${prefix}${line}`;
	return fitsWidth(placed, width) ? placed : truncateToWidth(placed, width, clip);
}

/**
 * Indent each line of an already-rendered block by `indent` columns, clipping
 * each to `width`. The block should be built at `width - indent` so nothing is
 * lost to the prefix; the clip is only a safety net. A line carrying an image
 * protocol sequence is passed through untouched, and trailing lines with no
 * visible content are dropped (by default). When `headline` is set, the first
 * non-blank line leads at `indent - BODY_INDENT` and the body follows directly —
 * no separator line — and its own leading blanks are dropped so a tool's spacing
 * never leaves a gap under the headline. With `rail` set, the body's first indent
 * column carries the glyph instead of a space; `railAfterCall` keeps the call's
 * continuation lines plain, so the rail starts with the result.
 */
export function indentBlockLines(body: readonly string[], width: number, options: IndentOptions = {}): string[] {
	const w = Math.max(1, width);
	const indent = clampIndent(options.indent ?? 0, w);
	const prefix = bodyPrefix(indent, options.rail);
	const plainPrefix = " ".repeat(indent);
	const clip = options.bodyClip ?? "";

	// The headline is the first line with something to say; it leads at the base.
	let headline: string | undefined;
	let rest: readonly string[] = body;
	if (options.headline) {
		const index = body.findIndex((line) => !IMAGE_LINE.test(line) && !isBlank(line));
		if (index >= 0) {
			headline = body[index];
			rest = body.slice(index + 1);
		}
	}

	// A call whose subject moved onto the body keeps those lines unrailed, so the
	// rail starts with the result rather than under a bare tool name.
	let railStart = 0;
	if (options.rail && options.railAfterCall) {
		while (railStart < rest.length && !isBlank(rest[railStart] ?? "")) railStart++;
	}

	const placed: string[] = [];
	for (const [index, line] of rest.entries()) {
		placed.push(IMAGE_LINE.test(line) ? line : place(index < railStart ? plainPrefix : prefix, line, w, clip));
	}

	// Trim by index over the source, which lines up one-to-one with the placed
	// lines, so a blank scan only walks the run it drops instead of every line.
	let start = 0;
	let end = rest.length;
	if (options.trimLeading) {
		while (start < end && isBlankBody(rest[start] ?? "")) start++;
	}
	if (options.trimTrailing !== false) {
		while (end > start && isBlankBody(rest[end - 1] ?? "")) end--;
	}

	const lead =
		headline === undefined ? undefined : place(" ".repeat(Math.max(0, indent - BODY_INDENT)), headline, w, "…");
	if (start === 0 && end === placed.length) {
		if (lead !== undefined) placed.unshift(lead);
		return placed;
	}
	const lines = placed.slice(start, end);
	if (lead !== undefined) lines.unshift(lead);
	return lines;
}

/**
 * Render `inner` at the width the indent leaves, so nothing is lost to the
 * prefix. An absent `inner` renders nothing, so a tool with no output adds no
 * blank block. The lines are not indented yet; a caller that has to inspect the
 * block before placing it passes them to `indentBlockLines`.
 */
export function bodyLines(inner: Component | undefined, width: number, indent = 0): string[] {
	if (!inner) return [];
	const w = Math.max(1, width);
	// The prefix is spaces here (no rail), so its width is the clamped indent.
	const prefixWidth = clampIndent(indent, w);
	return inner.render(Math.max(1, w - prefixWidth));
}

/** Render `inner` at the width the indent leaves, then indent it. */
export function indentedLines(inner: Component | undefined, width: number, options: IndentOptions = {}): string[] {
	const w = Math.max(1, width);
	const indent = clampIndent(options.indent ?? 0, w);
	return indentBlockLines(bodyLines(inner, w, indent), w, { ...options, indent });
}

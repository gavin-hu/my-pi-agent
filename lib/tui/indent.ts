/**
 * The transcript indent: how a non-prose block sits under its headline.
 *
 * A tool block, a shared notice, and a subagent's quoted output all hang from one
 * left edge — a plain indent, no glyph — so the transcript reads as one column
 * without a rail. A block may lead with a headline (a tool's own call line) at
 * the outer indent; the body sits `BODY_INDENT` further in, directly under it with
 * no separator line, which is what keeps a tool block compact.
 *
 * Value-only: pure functions and constants, no theme.
 */

import { type Component, stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";

/** Columns the body sits in beyond a block's outer indent. */
export const BODY_INDENT = 2;

/** How an indented block is placed. */
export interface IndentOptions {
	/** Columns the body is indented; a headline sits `BODY_INDENT` to its left. */
	indent?: number;
	/** Drop leading lines with no visible content. Default false. */
	trimLeading?: boolean;
	/** Drop trailing lines with no visible content. Default true. */
	trimTrailing?: boolean;
	/**
	 * Lead with the first non-blank line as the block's headline, at
	 * `indent - BODY_INDENT`, with the body immediately after it. Default false.
	 */
	headline?: boolean;
}

/**
 * A line with no visible text. Tested after stripping terminal sequences, so a
 * line that is only spaces carrying a background (a `Box`'s own padding) counts
 * as blank rather than as content.
 */
function isBlank(line: string): boolean {
	return stripTerminalSequences(line).trim().length === 0;
}

/** An image-protocol line must pass through unprefixed, or the sequence corrupts. */
const IMAGE_LINE = /^\u001b(?:P|_G|\]1337;)/;

/** The body indent, clamped so the prefix always leaves at least one column. */
function clampIndent(indent: number, width: number): number {
	return Math.max(0, Math.min(Math.floor(indent), Math.max(0, width - 1)));
}

/**
 * Indent each line of an already-rendered block by `indent` columns, clipping
 * each to `width`. The block should be built at `width - indent` so nothing is
 * lost to the prefix; the clip is only a safety net. A line carrying an image
 * protocol sequence is passed through untouched, and trailing lines with no
 * visible content are dropped (by default). When `headline` is set, the first
 * non-blank line leads at `indent - BODY_INDENT` and the body follows directly —
 * no separator line — and its own leading blanks are dropped so a tool's spacing
 * never leaves a gap under the headline.
 */
export function indentBlockLines(body: readonly string[], width: number, options: IndentOptions = {}): string[] {
	const w = Math.max(1, width);
	const indent = clampIndent(options.indent ?? 0, w);
	const prefix = " ".repeat(indent);

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

	const lines: string[] = [];
	const blank: boolean[] = [];
	for (const line of rest) {
		if (IMAGE_LINE.test(line)) {
			lines.push(line);
			blank.push(false);
			continue;
		}
		lines.push(truncateToWidth(`${prefix}${line}`, w, ""));
		blank.push(isBlank(line));
	}
	if (options.trimLeading) {
		while (blank.length > 0 && blank[0]) {
			lines.shift();
			blank.shift();
		}
	}
	if (options.trimTrailing !== false) {
		while (blank.length > 0 && blank[blank.length - 1]) {
			lines.pop();
			blank.pop();
		}
	}
	if (headline !== undefined) {
		const base = Math.max(0, indent - BODY_INDENT);
		lines.unshift(truncateToWidth(`${" ".repeat(base)}${headline}`, w, "…"));
	}
	return lines;
}

/**
 * Render `inner` at the width the indent leaves, then indent it. An absent
 * `inner` renders nothing, so a tool with no output adds no blank block.
 */
export function indentedLines(inner: Component | undefined, width: number, options: IndentOptions = {}): string[] {
	if (!inner) return [];
	const w = Math.max(1, width);
	const indent = clampIndent(options.indent ?? 0, w);
	return indentBlockLines(inner.render(Math.max(1, w - indent)), w, { ...options, indent });
}

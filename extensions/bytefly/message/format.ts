/**
 * The user-message prompt marker: a `❯` on the first line and a two-column
 * hanging indent on its continuation lines.
 *
 * Pi's user message component parses the transformed string as Markdown, so
 * shaping text is the only lever: the surface can add no component, color, or
 * box. Two properties of that pipeline make the marker work, both verified
 * against the pinned dependencies: marked keeps a paragraph continuation line's
 * leading spaces, and pi-tui's `wrapTextWithAnsi` splits on explicit newlines
 * and trims only at a wrap point, never a line's start. A soft wrap of one long
 * line therefore stays at the margin; hard-wrapping Markdown here would corrupt
 * a break inside an inline construct.
 *
 * The indent covers the first paragraph only. A blank line, or a line that opens
 * another block, ends it and the rest of the message is returned untouched, so a
 * code fence or a list keeps the layout the user wrote instead of shifting its
 * content two columns.
 */

import type { MarkdownTransformContext } from "@earendil-works/pi-coding-agent";
import { MESSAGE_CONFIG } from "./config.ts";

const { glyph, indent } = MESSAGE_CONFIG;

/** Up to three leading spaces are insignificant before a block-level construct. */
const LEADING_SPACES = /^ {0,3}/;

/** A line that opens a block-level construct, so it ends the marked paragraph. */
export function opensBlock(line: string): boolean {
	const text = line.replace(LEADING_SPACES, "");
	return (
		/^(?:`{3,}|~{3,})/.test(text) ||
		/^#{1,6}(?:\s|$)/.test(text) ||
		/^>/.test(text) ||
		/^(?:[-*+]|\d{1,9}[.)])[ \t]+\S/.test(text) ||
		/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text) ||
		/^\|.*\|/.test(text)
	);
}

/** The marker on the first line, then the first paragraph hung two columns in. */
function markMessage(markdown: string): string {
	const [first = "", ...rest] = markdown.split("\n");
	const marked = [`${glyph} ${first}`];
	let consumed = 0;
	for (const line of rest) {
		if (line.trim() === "" || opensBlock(line)) break;
		marked.push(`${indent}${line}`);
		consumed++;
	}
	marked.push(...rest.slice(consumed));
	return marked.join("\n");
}

/** Mark a user message; every other message passes through untouched. */
export function styleUserMessage(markdown: string, context: MarkdownTransformContext): string {
	if (context.messageType !== "user" || markdown.trim() === "") return markdown;
	// A leading marker would stop a block-leading first line from parsing, so the
	// fallback puts the marker alone on its own line.
	if (opensBlock(markdown.split("\n")[0] ?? "")) return `${glyph}\n\n${markdown}`;
	return markMessage(markdown);
}

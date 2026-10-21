/**
 * Model-facing text formatting and slicing for `read_doc`.
 *
 * `formatPage` slices extracted text by code point from `startIndex`, so CJK and
 * emoji stay well-formed, and names the offset of the next chunk. The body is
 * the clean slice; the text adds a header and any truncation note.
 */

import { formatCount } from "../../lib/format.ts";
import type { FormatId } from "./formats.ts";

export interface PageInput {
	/** The tool that produced this page; named in the truncation note. */
	tool: string;
	path: string;
	format: FormatId;
	bytes: number;
	text: string;
	startIndex: number;
	maxChars: number;
}

export interface FormattedPage {
	/** The requested slice of the extracted text. */
	body: string;
	/** Header, body, and any truncation note. */
	text: string;
	truncated: boolean;
	/** Offset to pass as `startIndex` for the next chunk. */
	nextIndex: number;
	/** Total characters in the extracted text. */
	chars: number;
}

export function formatPage(input: PageInput): FormattedPage {
	const points = Array.from(input.text);
	const total = points.length;
	const header = `Path: ${input.path}\nFormat: ${input.format.toUpperCase()}\nSize: ${input.bytes} bytes`;

	if (total === 0) {
		const text = `${header}\n\n(no extractable text; the file may be empty or contain no readable text)`;
		return { body: "", text, truncated: false, nextIndex: input.startIndex, chars: 0 };
	}

	if (input.startIndex >= total) {
		const text = `${header}\n\n(no text at startIndex ${input.startIndex}; total ${total} characters)`;
		return { body: "", text, truncated: false, nextIndex: total, chars: total };
	}

	const slice = points.slice(input.startIndex, input.startIndex + input.maxChars);
	const body = slice.join("");
	const nextIndex = input.startIndex + slice.length;
	const truncated = nextIndex < total;

	let text = `${header}\n\n${body}`;
	if (truncated) {
		text += `\n\n… (truncated at ${nextIndex} of ${total} characters; call ${input.tool} again with startIndex=${nextIndex})`;
	}

	return { body, text, truncated, nextIndex, chars: total };
}

/** Inputs for `summarizeRead`, the fields the transcript summary reads. */
export interface SummaryInput {
	format: FormatId;
	/** Total characters in the extracted text. */
	chars: number;
	startIndex: number;
	nextIndex: number;
	truncated: boolean;
}

/** Theme-free transcript summary: the format, the range detail, and any note. */
export interface PageSummary {
	/** Uppercase format id, e.g. `PDF`. */
	format: string;
	/** Range detail, e.g. `chars 1–40,000 of 42,478`. */
	detail: string;
	/** `next at N` when truncated, `complete` for a non-first final page. */
	note?: string;
	/** Whether more text remains; the renderer colours the note with this. */
	truncated: boolean;
}

/**
 * Describe a file-read result for the transcript, without theme colours.
 *
 * A complete first read shows the total; a paged read shows the returned range
 * and where to continue, so a truncated result is never mistaken for the whole
 * file.
 */
export function summarizeRead(input: SummaryInput): PageSummary {
	const format = input.format.toUpperCase();
	if (input.chars === 0) return { format, detail: "no extractable text", truncated: false };
	if (input.startIndex >= input.chars) {
		return {
			format,
			detail: `no text at ${formatCount(input.startIndex)} of ${formatCount(input.chars)} chars`,
			truncated: false,
		};
	}
	if (input.startIndex <= 0 && !input.truncated) {
		return { format, detail: `${formatCount(input.chars)} chars`, truncated: false };
	}
	const range = `chars ${formatCount(input.startIndex + 1)}–${formatCount(input.nextIndex)} of ${formatCount(input.chars)}`;
	return {
		format,
		detail: range,
		note: input.truncated ? `next at ${formatCount(input.nextIndex)}` : "complete",
		truncated: input.truncated,
	};
}

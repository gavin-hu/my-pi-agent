/**
 * Model-facing text formatting and slicing for `read_doc`.
 *
 * `formatDoc` slices extracted text by code point from `startIndex`, so CJK and
 * emoji stay well-formed, and names the offset of the next chunk. The body is
 * the clean slice; the text adds a header and any truncation note.
 */

import type { FormatId } from "./formats.ts";

export interface DocPageInput {
	path: string;
	format: FormatId;
	bytes: number;
	text: string;
	startIndex: number;
	maxChars: number;
}

export interface FormattedDoc {
	/** Header lines describing the file. */
	header: string;
	/** The requested slice of the document text. */
	body: string;
	/** Header, body, and any truncation note. */
	text: string;
	truncated: boolean;
	/** Offset to pass as `startIndex` for the next chunk. */
	nextIndex: number;
	/** Total characters in the extracted text. */
	chars: number;
}

export function formatDoc(input: DocPageInput): FormattedDoc {
	const points = Array.from(input.text);
	const total = points.length;
	const header = `Path: ${input.path}\nFormat: ${input.format.toUpperCase()}\nSize: ${input.bytes} bytes`;

	if (total === 0) {
		const text = `${header}\n\n(no extractable text; the document may be scanned or image-only)`;
		return { header, body: "", text, truncated: false, nextIndex: input.startIndex, chars: 0 };
	}

	if (input.startIndex >= total) {
		const text = `${header}\n\n(no text at startIndex ${input.startIndex}; total ${total} characters)`;
		return { header, body: "", text, truncated: false, nextIndex: total, chars: total };
	}

	const slice = points.slice(input.startIndex, input.startIndex + input.maxChars);
	const body = slice.join("");
	const nextIndex = input.startIndex + slice.length;
	const truncated = nextIndex < total;

	let text = `${header}\n\n${body}`;
	if (truncated) {
		text += `\n\n… (truncated at ${nextIndex} of ${total} characters; call read_doc again with startIndex=${nextIndex})`;
	}

	return { header, body, text, truncated, nextIndex, chars: total };
}

/** Inputs for `summarizeDoc`, the fields the transcript summary reads. */
export interface DocSummaryInput {
	path: string;
	format: FormatId;
	/** Total characters in the extracted text. */
	chars: number;
	startIndex: number;
	nextIndex: number;
	truncated: boolean;
}

/** Theme-free transcript summary: the path, the range detail, and any note. */
export interface DocSummary {
	/** Muted heading, normally the requested path. */
	path: string;
	/** Range detail, e.g. `docx · 1–40000 of 42478 chars`. */
	detail: string;
	/** `more at N` when truncated, `complete` for a non-first final page. */
	note?: string;
}

/**
 * Describe a `read_doc` result for the transcript, without theme colours.
 *
 * A complete first read shows the total; a paged read shows the returned range
 * so a truncated result is never mistaken for the whole document.
 */
export function summarizeDoc(input: DocSummaryInput): DocSummary {
	const prefix = `${input.format} · `;
	if (input.chars === 0) return { path: input.path, detail: `${prefix}0 chars` };
	if (input.startIndex <= 0 && !input.truncated) return { path: input.path, detail: `${prefix}${input.chars} chars` };
	if (input.nextIndex <= input.startIndex) {
		return { path: input.path, detail: `${prefix}no text at ${input.startIndex} of ${input.chars} chars` };
	}
	const range = `${prefix}${input.startIndex + 1}–${input.nextIndex} of ${input.chars} chars`;
	return { path: input.path, detail: range, note: input.truncated ? `more at ${input.nextIndex}` : "complete" };
}

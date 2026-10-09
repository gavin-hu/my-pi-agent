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
		const text = `${header}\n\n(no extractable text; possibly a scanned/image-only PDF)`;
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

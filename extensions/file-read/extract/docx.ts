/**
 * DOCX text extraction via the `mammoth` package.
 *
 * `mammoth.extractRawText` returns the body story as plain text, paragraphs
 * separated by blank lines. Headers, footers, footnotes, and comments are not
 * part of the body and so are not included.
 */

import { normalizeBodyText, readFormatBytes, type FormatExtractor } from "./file.ts";

/** Extract the body text from a DOCX file. */
export const extractDocxText: FormatExtractor = async (file) => {
	const bytes = await readFormatBytes(file);
	const module = await import("mammoth");
	const mammoth = module.default;
	const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
	return normalizeBodyText(value);
};

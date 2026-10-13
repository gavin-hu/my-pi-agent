/**
 * DOCX text extraction via the `mammoth` package.
 *
 * `mammoth.extractRawText` returns the body story as plain text, paragraphs
 * separated by blank lines. Headers, footers, footnotes, and comments are not
 * part of the body and so are not included.
 */

import { normalizeBodyText, readDocBytes, type DocExtractor } from "./file.ts";

/** Extract the body text from a DOCX file. */
export const extractDocxText: DocExtractor = async (file) => {
	const bytes = await readDocBytes(file);
	const module = await import("mammoth");
	const mammoth = module.default;
	const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
	return normalizeBodyText(value);
};

/**
 * PDF text extraction via the `unpdf` package.
 *
 * `unpdf` bundles a server-friendly build of PDF.js. `extractText` with
 * `mergePages: true` returns every page's reading-order text joined with a blank
 * line, so a page break reads as a paragraph break. No OCR: a scanned or
 * image-only PDF yields little or no text.
 */

import { readDocBytes, type DocExtractor } from "./file.ts";

/** Pull the merged text out of `unpdf`'s `{ totalPages, text }` result. Pure. */
export function pdfTextFromResult(result: unknown): string {
	if (typeof result === "string") return result;
	const text = (result as { text?: unknown } | undefined)?.text;
	return typeof text === "string" ? text : "";
}

/** Extract text from every page of a PDF. */
export const extractPdfText: DocExtractor = async (file) => {
	const bytes = await readDocBytes(file);
	const module = await import("unpdf");
	const result: unknown = await module.extractText(bytes, { mergePages: true });
	return pdfTextFromResult(result).replace(/\r\n?/g, "\n").replace(/\n+$/, "");
};

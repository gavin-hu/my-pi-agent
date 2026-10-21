/**
 * PDF text extraction, over the shared `unpdf` seam.
 *
 * `lib/pdf.ts` owns the lazy import, the module-shape handling, and the
 * guidance when the package is absent; this adapter reads the file and applies
 * the body normalization `read_doc` returns for a PDF.
 */

import { extractPdfText } from "../../../lib/pdf.ts";
import { readDocBytes, type DocExtractor } from "./file.ts";

/** Extract text from every page of a PDF. */
export const extractPdfDocument: DocExtractor = async (file) => {
	const bytes = await readDocBytes(file);
	const text = await extractPdfText(bytes);
	return text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
};

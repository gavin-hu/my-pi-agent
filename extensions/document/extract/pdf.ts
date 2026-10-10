/**
 * PDF text extraction via `pdfcraft-cli`.
 *
 * `pdfcraft-cli text <file>` prints every page's reading-order text, one page
 * per line group, with a line containing a form feed (`\u{c}`) before each page
 * after the first. The extractor joins the pages into one plain-text document,
 * matching the merged output the tool returned before. The CLI reads the file
 * itself, so this module never touches the bytes.
 */

import type { DocCli, DocFile } from "./cli.ts";

/**
 * Split `pdfcraft-cli`'s form-feed-separated pages into blank-line-separated
 * text. Pure; used by the extractor and asserted directly in tests.
 */
export function mergePdfPages(stdout: string): string {
	return stdout
		.split("\u{c}")
		.map((page) => page.replace(/^\n+|\n+$/g, ""))
		.filter((page) => page !== "")
		.join("\n\n");
}

/** Extract plain text from every page of a PDF via `pdfcraft-cli text`. */
export async function extractPdfText(file: DocFile, cli: DocCli): Promise<string> {
	const stdout = await cli.run("pdfcraft-cli", ["text", file.path], { signal: file.signal });
	return mergePdfPages(stdout);
}

/**
 * Word-processing text extraction via `wordcraft-cli`.
 *
 * `wordcraft-cli text <file>` prints the document body's plain text for every
 * WordCraft-readable format: DOCX, legacy DOC, ODT, and RTF. Paragraphs are
 * separated by newlines and table cells by tabs. The CLI reads the file itself,
 * so this module never touches the bytes.
 */

import type { DocCli, DocFile } from "./cli.ts";

/** Drop the single trailing newline `wordcraft-cli text` adds with `println!`. */
export function stripTrailingNewline(stdout: string): string {
	return stdout.replace(/\r?\n$/, "");
}

/** Extract plain text from a word-processing document via `wordcraft-cli text`. */
export async function extractWordcraftText(file: DocFile, cli: DocCli): Promise<string> {
	const stdout = await cli.run("wordcraft-cli", ["text", file.path], { signal: file.signal });
	return stripTrailingNewline(stdout);
}

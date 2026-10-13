/**
 * The in-process extractor contract for `read_doc`.
 *
 * Each document format is extracted by a JavaScript library that reads the file
 * itself. This module owns the file read, the abort check, and the
 * {@link DocExtractor} type, so the format modules stay tiny and testable
 * through real fixtures.
 *
 * Imports of the extraction libraries are lazy (`await import(...)` inside each
 * extractor): the extension registers on every session, but a parser only loads
 * when a read actually needs it, matching `web-access`'s lazy `unpdf` import.
 */

import { readFile } from "node:fs/promises";

/** What an extractor receives: the real, root-confined absolute path. */
export interface DocFile {
	/** Absolute, symlink-resolved path inside the effective working root. */
	path: string;
	/** The active turn's abort signal, checked before any work. */
	signal?: AbortSignal;
}

/** Extract plain text for one file. */
export type DocExtractor = (file: DocFile) => Promise<string>;

/** Read the whole file, refusing to start once the turn is aborted. */
export async function readDocBytes(file: DocFile): Promise<Uint8Array> {
	file.signal?.throwIfAborted();
	const bytes = await readFile(file.path);
	file.signal?.throwIfAborted();
	return new Uint8Array(bytes);
}

/**
 * Normalize extracted body text: CRLF to LF, collapse runs of blank lines to
 * one, strip trailing spaces and newlines. Pure.
 */
export function normalizeBodyText(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/\n+$/, "");
}

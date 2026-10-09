/**
 * The supported document formats, in one table.
 *
 * The tool handler, the config defaults, the `formats` merge, and the
 * unsupported-file error all derive from `FORMATS`, so adding a format is a
 * local change: one extractor module plus one entry here. See the README's
 * "Adding a format" section.
 */

import { extname } from "node:path";
import { extractDocxText } from "./extract/docx.ts";
import { extractPdfText } from "./extract/pdf.ts";

export interface DocumentFormat {
	/** Stable id, also the `doc.json` `formats` key and the output `format`. */
	id: "pdf" | "docx";
	/** Human label for messages. */
	label: string;
	/** Lower-case extensions, with the dot, that select this format. */
	extensions: readonly string[];
	/** Enabled unless `doc.json` `formats[id]` says otherwise. */
	defaultEnabled: boolean;
	/** Lazy optional-dependency extractor; throws *UnavailableError when absent. */
	extract: (bytes: Uint8Array) => Promise<string>;
}

export const FORMATS = [
	{ id: "pdf", label: "PDF", extensions: [".pdf"], defaultEnabled: true, extract: extractPdfText },
	{ id: "docx", label: "DOCX", extensions: [".docx"], defaultEnabled: true, extract: extractDocxText },
] as const satisfies readonly DocumentFormat[];

export type FormatId = (typeof FORMATS)[number]["id"];

/** Every registered format id, in table order. */
export function formatIds(): readonly FormatId[] {
	return FORMATS.map((format) => format.id);
}

/** Every supported extension, e.g. `[".pdf", ".docx"]`. */
export function supportedExtensions(): string[] {
	return FORMATS.flatMap((format) => [...format.extensions]);
}

/** The format selected by a path's extension, or undefined when unsupported. */
export function detectFormat(path: string): DocumentFormat | undefined {
	const ext = extname(path).toLowerCase();
	return FORMATS.find((format) => (format.extensions as readonly string[]).includes(ext));
}

/** A targeted hint for a known-but-unsupported extension, or undefined. */
export function unsupportedHint(path: string): string | undefined {
	const ext = extname(path).toLowerCase();
	if (ext === ".doc") return "Legacy .doc is not supported; convert it to .docx first.";
	return undefined;
}

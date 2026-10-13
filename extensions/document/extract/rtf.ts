/**
 * RTF text extraction via the `rtf-parser` package.
 *
 * `rtf-parser` produces a document tree of paragraphs and styled text spans.
 * This module flattens that tree to plain text: runs of span values joined
 * within a paragraph, paragraphs separated by newlines. Formatting is dropped.
 */

import { normalizeBodyText, readDocBytes, type DocExtractor } from "./file.ts";

interface RtfNode {
	value?: string;
	content?: RtfNode[];
}

interface RtfDocument {
	content: RtfNode[];
}

/** The text of one node: a span value, or its children's values. */
function nodeText(node: RtfNode): string {
	if (typeof node.value === "string") return node.value;
	if (Array.isArray(node.content)) return node.content.map(nodeText).join("");
	return "";
}

/** Flatten a parsed RTF document to plain text. Pure. */
export function rtfDocumentToText(document: RtfDocument): string {
	return normalizeBodyText(document.content.map((node) => nodeText(node).trim()).join("\n"));
}

/** Parse an RTF string with `rtf-parser`'s callback API. */
async function parseRtf(input: string): Promise<RtfDocument> {
	const module = await import("rtf-parser");
	const parse = module.default;
	return new Promise((resolve, reject) => {
		parse.string(input, (error, document) => (error ? reject(error) : resolve(document)));
	});
}

/** Extract the body text from an RTF file. */
export const extractRtfText: DocExtractor = async (file) => {
	const bytes = await readDocBytes(file);
	return rtfDocumentToText(await parseRtf(new TextDecoder().decode(bytes)));
};

/**
 * ODT text extraction.
 *
 * An ODT file is a ZIP whose `content.xml` holds the document body. This module
 * unzips it with `fflate`, parses the XML with `fast-xml-parser`, and walks the
 * body for text: paragraphs and headings become lines, table cells are
 * tab-separated, and `text:s` / `text:tab` / `text:line-break` become their
 * whitespace. Both libraries load on the first ODT read, never at registration,
 * so a session that never opens one pays nothing for them; the walk over the
 * parsed tree is pure and tested directly.
 */

import { normalizeBodyText, readFormatBytes, type FormatExtractor } from "./file.ts";

/** Elements that end a line. */
const BLOCK_ELEMENTS = new Set(["text:p", "text:h", "text:list-item"]);

type XmlNode = Record<string, unknown>;

/** The element name of a `preserveOrder` node, or undefined for a text node. */
function nodeName(node: XmlNode): string | undefined {
	return Object.keys(node).find((key) => key !== "#text" && key !== ":@");
}

/** The `text:c` repeat count of a `text:s` element, defaulting to one space. */
function spaceRun(node: XmlNode): number {
	const attributes = node[":@"] as Record<string, unknown> | undefined;
	const raw = attributes?.["@_text:c"];
	const count = Number(raw);
	return Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
}

/** Collect the text of a `preserveOrder` node list into `out`. */
function collect(nodes: unknown, out: string[], inText: boolean): void {
	if (!Array.isArray(nodes)) return;
	for (const raw of nodes) {
		if (typeof raw !== "object" || raw === null) continue;
		const node = raw as XmlNode;
		if (typeof node["#text"] === "string" || typeof node["#text"] === "number") {
			const value = String(node["#text"]);
			// Between structural elements the pretty-printed XML whitespace is noise;
			// inside text elements it is content and must be kept.
			if (inText || value.trim() !== "") out.push(value);
			continue;
		}
		const name = nodeName(node);
		if (!name) continue;

		if (name === "text:line-break") {
			out.push("\n");
			continue;
		}
		if (name === "text:tab") {
			out.push("\t");
			continue;
		}
		if (name === "text:s") {
			out.push(" ".repeat(spaceRun(node)));
			continue;
		}

		const childInText = inText || name.startsWith("text:") || name === "table:table-cell";
		collect(node[name], out, childInText);
		if (BLOCK_ELEMENTS.has(name)) out.push("\n");
		else if (name === "table:table-cell") out.push("\t");
		else if (name === "table:table-row") out.push("\n");
	}
}

/**
 * Extract plain text from the body of an ODT `content.xml`.
 *
 * Trailing tabs and spaces at line ends, runs of blank lines, and the final
 * newline are stripped so the tool's paging sees ordinary text.
 */
export async function odtXmlToText(xml: string): Promise<string> {
	const { XMLParser } = await import("fast-xml-parser");
	const parser = new XMLParser({
		preserveOrder: true,
		ignoreAttributes: false,
		parseTagValue: false,
		parseAttributeValue: false,
		trimValues: false,
	});
	const parsed = parser.parse(xml) as unknown;
	const out: string[] = [];
	collect(parsed, out, false);
	return normalizeBodyText(
		out
			.join("")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\t+\n/g, "\n"),
	).trim();
}

/** Extract the body text from an ODT file. */
export const extractOdtText: FormatExtractor = async (file) => {
	const { strFromU8, unzipSync } = await import("fflate");
	const archive = unzipSync(await readFormatBytes(file));
	const content = archive["content.xml"];
	if (!content) throw new Error("ODT archive has no content.xml.");
	return odtXmlToText(strFromU8(content));
};

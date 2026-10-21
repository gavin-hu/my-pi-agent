/**
 * File-read extraction capability suite.
 *
 * Two halves: the pure text builders each parser exposes (`normalizeBodyText`,
 * `odtXmlToText`, `rtfDocumentToText`, `cellToText`, `sheetsToText`) and the
 * extractors themselves against genuine minimal files. The parsers are real
 * libraries, so a fixture that stops parsing is a real regression rather than a
 * broken stub.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Workbook } from "exceljs";
import { strToU8, zipSync } from "fflate";
import { extractDocText } from "./doc.ts";
import { extractDocxText } from "./docx.ts";
import { normalizeBodyText, readFormatBytes } from "./file.ts";
import { extractOdtText, odtXmlToText } from "./odt.ts";
import { extractPdfDocument } from "./pdf.ts";
import { extractRtfText, rtfDocumentToText } from "./rtf.ts";
import { cellToText, extractXlsxText, sheetsToText } from "./xlsx.ts";
import { makeReadFixture } from "../../../test/helpers/fixtures/file-read.ts";
import { buildDocx, buildOdt, buildPdf, buildRtf, legacyDocBytes } from "../../../test/helpers/fixtures/documents.ts";

const fixture = makeReadFixture();
afterAll(() => fixture.remove());

/** An ODT `content.xml` wrapping `body` in the office/text namespaces. */
function odtContent(body: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
<office:body><office:text>${body}</office:text></office:body></office:document-content>`;
}

/** A real workbook written by exceljs, sheet name → rows. */
async function buildXlsx(sheets: Record<string, unknown[][]>): Promise<Uint8Array> {
	const workbook = new Workbook();
	for (const [name, rows] of Object.entries(sheets)) {
		const worksheet = workbook.addWorksheet(name);
		for (const row of rows) worksheet.addRow(row);
	}
	const buffer = await workbook.xlsx.writeBuffer();
	return new Uint8Array(buffer as ArrayBuffer);
}

describe("body normalization", () => {
	test("converts CRLF and lone CR to LF", () => {
		expect(normalizeBodyText("a\r\nb\rc")).toBe("a\nb\nc");
	});

	test("collapses runs of blank lines to one", () => {
		expect(normalizeBodyText("a\n\n\n\nb")).toBe("a\n\nb");
	});

	test("strips trailing spaces and newlines", () => {
		expect(normalizeBodyText("a  \nb\n\n")).toBe("a\nb");
	});
});

describe("file reads", () => {
	test("reads the file as bytes", async () => {
		const path = fixture.write("bytes.bin", "hello");
		expect(await readFormatBytes({ path })).toEqual(new TextEncoder().encode("hello"));
	});

	test("refuses to start when the signal is already aborted", async () => {
		const path = fixture.write("aborted.bin", "hello");
		const controller = new AbortController();
		controller.abort();
		await expect(readFormatBytes({ path, signal: controller.signal })).rejects.toThrow();
	});
});

describe("PDF", () => {
	test("extracts the text of a real one-page PDF", async () => {
		const path = fixture.write("read.pdf", buildPdf("Hello PDF"));
		expect(await extractPdfDocument({ path })).toContain("Hello PDF");
	});

	test("propagates a read error", async () => {
		await expect(extractPdfDocument({ path: join(fixture.root, "missing.pdf") })).rejects.toThrow();
	});
});

describe("DOCX", () => {
	test("extracts the body paragraphs of a real DOCX", async () => {
		const path = fixture.write("read.docx", buildDocx(["First paragraph", "Second paragraph"]));
		const text = await extractDocxText({ path });
		expect(text).toContain("First paragraph\n\nSecond paragraph");
	});

	test("propagates a parse error for a file that is not a DOCX", async () => {
		const path = fixture.write("bad.docx", "not a zip");
		await expect(extractDocxText({ path })).rejects.toThrow();
	});
});

describe("legacy DOC", () => {
	test("extracts the body story of a real legacy .doc", async () => {
		const path = fixture.write("legacy.doc", legacyDocBytes());

		const text = await extractDocText({ path });

		expect(text).toContain("Legacy Word fixture.\n\nSecond paragraph.");
	});

	test("rejects a file that is neither OLE nor ZIP", async () => {
		const path = fixture.write("bad.doc", "plain text, not a Word file");
		await expect(extractDocText({ path })).rejects.toThrow(/Unable to read this type of file/);
	});
});

describe("ODT text builder", () => {
	test("turns paragraphs into lines", () => {
		expect(odtXmlToText(odtContent("<text:p>Alpha</text:p><text:p>Beta</text:p>"))).toBe("Alpha\nBeta");
	});

	test("turns headings and spans into text", () => {
		expect(odtXmlToText(odtContent("<text:h>Title</text:h><text:p>a<text:span>b</text:span>c</text:p>"))).toBe(
			"Title\nabc",
		);
	});

	test("separates table cells with tabs and rows with newlines", () => {
		const body =
			"<table:table><table:table-row><table:table-cell>a</table:table-cell><table:table-cell>b</table:table-cell></table:table-row><table:table-row><table:table-cell>1</table:table-cell><table:table-cell>2</table:table-cell></table:table-row></table:table>";
		expect(odtXmlToText(odtContent(body))).toBe("a\tb\n1\t2");
	});

	test("expands a text:s run and a tab", () => {
		expect(odtXmlToText(odtContent('<text:p>a<text:s text:c="3"/>b<text:tab/>c</text:p>'))).toBe(
			`a${" ".repeat(3)}b\tc`,
		);
	});

	test("turns a line break into a newline", () => {
		expect(odtXmlToText(odtContent("<text:p>a<text:line-break/>b</text:p>"))).toBe("a\nb");
	});
});

describe("ODT", () => {
	test("extracts paragraphs from a real ODT", async () => {
		const path = fixture.write("read.odt", buildOdt("<text:p>Alpha</text:p><text:p>Beta</text:p>"));
		expect(await extractOdtText({ path })).toBe("Alpha\nBeta");
	});

	test("rejects an archive without content.xml", async () => {
		const path = fixture.write("empty.odt", zipSync({ mimetype: strToU8("application/vnd.oasis.opendocument.text") }));
		await expect(extractOdtText({ path })).rejects.toThrow(/content\.xml/);
	});
});

describe("RTF text builder", () => {
	test("concatenates spans within a paragraph and separates paragraphs", () => {
		const document = {
			content: [{ content: [{ value: "Hello " }, { value: "world" }] }, { content: [{ value: "Second" }] }],
		};
		expect(rtfDocumentToText(document)).toBe("Hello world\nSecond");
	});

	test("trims paragraph edges and drops empty trailing lines", () => {
		expect(rtfDocumentToText({ content: [{ content: [{ value: "  padded  " }] }] })).toBe("padded");
	});

	test("returns an empty string for an empty document", () => {
		expect(rtfDocumentToText({ content: [] })).toBe("");
	});
});

describe("RTF", () => {
	test("extracts paragraphs from a real RTF document", async () => {
		const path = fixture.write("read.rtf", buildRtf(["Hello RTF", "Second line"]));
		expect(await extractRtfText({ path })).toBe("Hello RTF\nSecond line");
	});

	test("propagates a read error", async () => {
		await expect(extractRtfText({ path: join(fixture.root, "missing.rtf") })).rejects.toThrow();
	});
});

describe("XLSX cells", () => {
	const cases: ReadonlyArray<readonly [string, unknown, string]> = [
		["empty for null", null, ""],
		["empty for undefined", undefined, ""],
		["keeps a string", "hello", "hello"],
		["trims a string", "  hi  ", "hi"],
		["collapses a tab", "a\tb", "a b"],
		["collapses a newline", "a\nb", "a b"],
		["strips control characters", "a\u0001b", "a b"],
	];
	for (const [name, value, expected] of cases) {
		test(name, () => {
			expect(cellToText(value)).toBe(expected);
		});
	}
});

describe("XLSX sheets", () => {
	test("renders a sheet with a heading and tab-separated rows", () => {
		expect(
			sheetsToText([
				{
					sheet: "Sheet1",
					data: [
						["a", "b"],
						["1", "2"],
					],
				},
			]),
		).toBe("[Sheet1]\na\tb\n1\t2");
	});

	test("renders multiple sheets separated by a blank line", () => {
		expect(
			sheetsToText([
				{ sheet: "One", data: [["a"]] },
				{ sheet: "Two", data: [["b"]] },
			]),
		).toBe("[One]\na\n\n[Two]\nb");
	});

	test("drops trailing empty cells and fully empty rows", () => {
		expect(sheetsToText([{ sheet: "S", data: [["a", "", null], ["", "", ""], ["b"]] }])).toBe("[S]\na\nb");
	});

	test("skips a sheet with no content", () => {
		expect(
			sheetsToText([
				{ sheet: "Empty", data: [["", ""]] },
				{ sheet: "Full", data: [["x"]] },
			]),
		).toBe("[Full]\nx");
	});

	test("returns nothing for a non-array or malformed input", () => {
		expect(sheetsToText("nope")).toBe("");
		expect(sheetsToText(undefined)).toBe("");
		expect(sheetsToText([{ nope: true }])).toBe("");
	});
});

describe("XLSX", () => {
	test("reads every non-empty sheet as [Sheet] plus tab rows", async () => {
		const bytes = await buildXlsx({
			One: [
				["a", "b"],
				[1, 2],
			],
			Two: [["z"]],
		});
		const path = fixture.write("read.xlsx", bytes);
		expect(await extractXlsxText({ path })).toBe("[One]\na\tb\n1\t2\n\n[Two]\nz");
	});

	test("uses a formula's computed value as its displayed text", async () => {
		const bytes = await buildXlsx({ Calc: [["1", "2", { formula: "A1+B1", result: 3 }]] });
		const path = fixture.write("calc.xlsx", bytes);
		expect(await extractXlsxText({ path })).toBe("[Calc]\n1\t2\t3");
	});

	test("propagates a parse error for a file that is not a workbook", async () => {
		const path = fixture.write("bad.xlsx", "not a zip");
		await expect(extractXlsxText({ path })).rejects.toThrow();
	});
});

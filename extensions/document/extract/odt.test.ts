import { afterAll, describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { extractOdtText, odtXmlToText } from "./odt.ts";
import { makeDocumentFixture } from "../../../test/helpers/fixtures/document.ts";
import { buildOdt } from "../../../test/helpers/fixtures/documents.ts";

const fixture = makeDocumentFixture();
afterAll(() => fixture.remove());

function content(body: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
<office:body><office:text>${body}</office:text></office:body></office:document-content>`;
}

describe("odtXmlToText", () => {
	test("turns paragraphs into lines", () => {
		expect(odtXmlToText(content("<text:p>Alpha</text:p><text:p>Beta</text:p>"))).toBe("Alpha\nBeta");
	});

	test("turns headings and spans into text", () => {
		expect(odtXmlToText(content("<text:h>Title</text:h><text:p>a<text:span>b</text:span>c</text:p>"))).toBe(
			"Title\nabc",
		);
	});

	test("separates table cells with tabs and rows with newlines", () => {
		const body =
			"<table:table><table:table-row><table:table-cell>a</table:table-cell><table:table-cell>b</table:table-cell></table:table-row><table:table-row><table:table-cell>1</table:table-cell><table:table-cell>2</table:table-cell></table:table-row></table:table>";
		expect(odtXmlToText(content(body))).toBe("a\tb\n1\t2");
	});

	test("expands a text:s run and a tab", () => {
		// The run of spaces is the content being checked, not layout.
		expect(odtXmlToText(content('<text:p>a<text:s text:c="3"/>b<text:tab/>c</text:p>'))).toBe("a   b\tc"); // allow:padding assertion
	});

	test("turns a line break into a newline", () => {
		expect(odtXmlToText(content("<text:p>a<text:line-break/>b</text:p>"))).toBe("a\nb");
	});
});

describe("extractOdtText", () => {
	test("extracts paragraphs from a real ODT", async () => {
		const path = fixture.write("read.odt", buildOdt("<text:p>Alpha</text:p><text:p>Beta</text:p>"));
		expect(await extractOdtText({ path })).toBe("Alpha\nBeta");
	});

	test("rejects an archive without content.xml", async () => {
		const path = fixture.write("empty.odt", zipSync({ mimetype: strToU8("application/vnd.oasis.opendocument.text") }));
		await expect(extractOdtText({ path })).rejects.toThrow(/content\.xml/);
	});
});

import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { extractRtfText, rtfDocumentToText } from "./rtf.ts";
import { makeDocumentFixture } from "../../../test/helpers/fixtures/document.ts";
import { buildRtf } from "../../../test/helpers/fixtures/documents.ts";

const fixture = makeDocumentFixture();
afterAll(() => fixture.remove());

describe("rtfDocumentToText", () => {
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

describe("extractRtfText", () => {
	test("extracts paragraphs from a real RTF document", async () => {
		const path = fixture.write("read.rtf", buildRtf(["Hello RTF", "Second line"]));
		expect(await extractRtfText({ path })).toBe("Hello RTF\nSecond line");
	});

	test("propagates a read error", async () => {
		await expect(extractRtfText({ path: join(fixture.root, "missing.rtf") })).rejects.toThrow();
	});
});

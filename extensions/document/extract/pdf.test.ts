import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { extractPdfText, pdfTextFromResult } from "./pdf.ts";
import { makeDocumentFixture } from "../../../test/helpers/fixtures/document.ts";
import { buildPdf } from "../../../test/helpers/fixtures/documents.ts";

const fixture = makeDocumentFixture();
afterAll(() => fixture.remove());

describe("pdfTextFromResult", () => {
	test("reads the text field of a merged result", () => {
		expect(pdfTextFromResult({ totalPages: 2, text: "body" })).toBe("body");
	});

	test("accepts a bare string", () => {
		expect(pdfTextFromResult("body")).toBe("body");
	});

	test("returns an empty string for anything else", () => {
		expect(pdfTextFromResult(undefined)).toBe("");
		expect(pdfTextFromResult({})).toBe("");
	});
});

describe("extractPdfText", () => {
	test("extracts the text of a real one-page PDF", async () => {
		const path = fixture.write("read.pdf", buildPdf("Hello PDF"));
		expect(await extractPdfText({ path })).toContain("Hello PDF");
	});

	test("propagates a read error", async () => {
		await expect(extractPdfText({ path: join(fixture.root, "missing.pdf") })).rejects.toThrow();
	});
});

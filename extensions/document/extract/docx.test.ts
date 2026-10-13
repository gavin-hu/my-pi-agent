import { afterAll, describe, expect, test } from "bun:test";
import { extractDocxText } from "./docx.ts";
import { makeDocumentFixture } from "../../../test/helpers/fixtures/document.ts";
import { buildDocx } from "../../../test/helpers/fixtures/documents.ts";

const fixture = makeDocumentFixture();
afterAll(() => fixture.remove());

describe("extractDocxText", () => {
	test("extracts paragraphs from a real DOCX as blank-line-separated text", async () => {
		const path = fixture.write("read.docx", buildDocx(["First paragraph", "Second paragraph"]));
		const text = await extractDocxText({ path });
		expect(text).toContain("First paragraph");
		expect(text).toContain("Second paragraph");
		expect(text).not.toMatch(/\n$/);
	});

	test("propagates a parse error for a file that is not a DOCX", async () => {
		const path = fixture.write("bad.docx", "not a zip");
		await expect(extractDocxText({ path })).rejects.toThrow();
	});
});

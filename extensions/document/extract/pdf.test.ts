import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { extractPdfDocument } from "./pdf.ts";
import { makeDocumentFixture } from "../../../test/helpers/fixtures/document.ts";
import { buildPdf } from "../../../test/helpers/fixtures/documents.ts";

const fixture = makeDocumentFixture();
afterAll(() => fixture.remove());

describe("extractPdfDocument", () => {
	test("extracts the text of a real one-page PDF", async () => {
		const path = fixture.write("read.pdf", buildPdf("Hello PDF"));
		expect(await extractPdfDocument({ path })).toContain("Hello PDF");
	});

	test("propagates a read error", async () => {
		await expect(extractPdfDocument({ path: join(fixture.root, "missing.pdf") })).rejects.toThrow();
	});
});

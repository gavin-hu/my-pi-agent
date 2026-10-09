import { afterEach, describe, expect, test } from "bun:test";
import { PdfUnavailableError, extractPdfText, setPdfExtractorForTests, setPdfLoaderForTests } from "./pdf.ts";

afterEach(() => {
	setPdfExtractorForTests(undefined);
	setPdfLoaderForTests(undefined);
});

describe("extractPdfText", () => {
	test("uses the injected extractor", async () => {
		setPdfExtractorForTests(async (bytes) => `len=${bytes.length}`);
		expect(await extractPdfText(new Uint8Array([1, 2, 3]))).toBe("len=3");
	});

	test("surfaces a typed unavailable error from the loader", async () => {
		setPdfLoaderForTests(async () => {
			throw new PdfUnavailableError("PDF extraction requires the optional 'unpdf' package (npm i unpdf).");
		});
		await expect(extractPdfText(new Uint8Array())).rejects.toBeInstanceOf(PdfUnavailableError);
	});
});

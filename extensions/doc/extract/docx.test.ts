import { afterEach, describe, expect, test } from "bun:test";
import { DocxUnavailableError, extractDocxText, setDocxExtractorForTests, setDocxLoaderForTests } from "./docx.ts";

afterEach(() => {
	setDocxExtractorForTests(undefined);
	setDocxLoaderForTests(undefined);
});

describe("extractDocxText", () => {
	test("uses the injected extractor", async () => {
		setDocxExtractorForTests(async (bytes) => `len=${bytes.length}`);
		expect(await extractDocxText(new Uint8Array([1, 2]))).toBe("len=2");
	});

	test("surfaces a typed unavailable error from the loader", async () => {
		setDocxLoaderForTests(async () => {
			throw new DocxUnavailableError("DOCX extraction requires the optional 'mammoth' package (npm i mammoth).");
		});
		await expect(extractDocxText(new Uint8Array())).rejects.toBeInstanceOf(DocxUnavailableError);
	});
});

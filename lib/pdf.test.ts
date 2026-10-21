import { describe, expect, test } from "bun:test";
import { extractPdfText, PdfUnavailableError, pdfExtractorFromModule, pdfGuidance, pdfTextFromResult } from "./pdf.ts";

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

describe("pdfExtractorFromModule", () => {
	test("calls a named extractText with merged pages", async () => {
		let seen: { size: number; options: unknown } | undefined;
		const extractor = pdfExtractorFromModule({
			extractText: async (bytes: Uint8Array, options: unknown) => {
				seen = { size: bytes.length, options };
				return { totalPages: 1, text: "body" };
			},
		});

		expect(await extractor(new Uint8Array([1, 2]))).toBe("body");
		expect(seen).toEqual({ size: 2, options: { mergePages: true } });
	});

	test("falls back to the default export's extractText", async () => {
		const extractor = pdfExtractorFromModule({
			default: { extractText: async () => "wrapped" },
		});
		expect(await extractor(new Uint8Array())).toBe("wrapped");
	});

	test("rejects a module without extractText", () => {
		expect(() => pdfExtractorFromModule({})).toThrow(PdfUnavailableError);
		expect(() => pdfExtractorFromModule({ extractText: "not a function" })).toThrow(PdfUnavailableError);
		expect(() => pdfExtractorFromModule(null)).toThrow(PdfUnavailableError);
	});
});

describe("extractPdfText", () => {
	test("uses an injected extractor instead of loading unpdf", async () => {
		const text = await extractPdfText(new Uint8Array([1]), async (bytes) => `injected ${bytes.length}`);
		expect(text).toBe("injected 1");
	});
});

describe("pdfGuidance", () => {
	test("names the install command", () => {
		expect(pdfGuidance()).toContain("npm i unpdf");
	});
});

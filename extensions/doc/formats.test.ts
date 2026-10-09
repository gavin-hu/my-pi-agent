import { describe, expect, test } from "bun:test";
import { FORMATS, detectFormat, formatIds, supportedExtensions, unsupportedHint } from "./formats.ts";

describe("FORMATS registry", () => {
	test("ids and extensions are unique and dotted", () => {
		const ids = FORMATS.map((format) => format.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(formatIds()).toEqual(ids);

		const extensions = supportedExtensions();
		expect(new Set(extensions).size).toBe(extensions.length);
		for (const extension of extensions) expect(extension.startsWith(".")).toBe(true);
	});
});

describe("detectFormat", () => {
	test("maps supported extensions case-insensitively", () => {
		expect(detectFormat("a.pdf")?.id).toBe("pdf");
		expect(detectFormat("a.DOCX")?.id).toBe("docx");
		expect(detectFormat("a.XLSX")?.id).toBe("xlsx");
	});

	test("returns undefined for unsupported paths", () => {
		expect(detectFormat("a.txt")).toBeUndefined();
		expect(detectFormat("noext")).toBeUndefined();
	});
});

describe("unsupportedHint", () => {
	test("names the legacy .doc case", () => {
		expect(unsupportedHint("old.doc")).toMatch(/\.docx/);
		expect(unsupportedHint("old.pdf")).toBeUndefined();
	});

	test("names the legacy .xls case", () => {
		expect(unsupportedHint("old.xls")).toMatch(/\.xlsx/);
	});
});

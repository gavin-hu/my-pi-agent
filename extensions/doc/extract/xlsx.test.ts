import { afterEach, describe, expect, test } from "bun:test";
import {
	cellToText,
	extractXlsxText,
	setXlsxExtractorForTests,
	setXlsxLoaderForTests,
	sheetsToText,
	XlsxUnavailableError,
} from "./xlsx.ts";

afterEach(() => {
	setXlsxExtractorForTests(undefined);
	setXlsxLoaderForTests(undefined);
});

// A fixed Date value is the input under test, not a wall-clock assertion.
const date = (iso: string): Date => new Date(iso); // allow:wall clock

describe("extractXlsxText", () => {
	test("uses the injected extractor", async () => {
		setXlsxExtractorForTests(async (bytes) => `len=${bytes.length}`);
		expect(await extractXlsxText(new Uint8Array([1, 2]))).toBe("len=2");
	});

	test("surfaces a typed unavailable error from the loader", async () => {
		setXlsxLoaderForTests(async () => {
			throw new XlsxUnavailableError("XLSX extraction requires the 'read-excel-file' package.");
		});
		await expect(extractXlsxText(new Uint8Array())).rejects.toBeInstanceOf(XlsxUnavailableError);
	});
});

describe("cellToText", () => {
	const cases: ReadonlyArray<readonly [string, unknown, string]> = [
		["empty for null", null, ""],
		["empty for undefined", undefined, ""],
		["keeps a string", "hello", "hello"],
		["trims a string", "  hi  ", "hi"],
		["stringifies a number", 42, "42"],
		["formats a midnight date as a day", date("2020-01-02T00:00:00.000Z"), "2020-01-02"],
		["keeps the time on a timed date", date("2020-01-02T03:04:05.000Z"), "2020-01-02T03:04:05.000Z"],
		["uppercases a boolean", true, "TRUE"],
		["formats false", false, "FALSE"],
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

describe("sheetsToText", () => {
	test("renders a sheet with a heading and tab-separated rows", () => {
		expect(
			sheetsToText([
				{
					sheet: "Sheet1",
					data: [
						["a", "b"],
						[1, 2],
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

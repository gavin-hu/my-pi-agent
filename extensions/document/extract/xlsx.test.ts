import { afterAll, describe, expect, test } from "bun:test";
import { Workbook } from "exceljs";
import { cellToText, extractXlsxText, sheetsToText } from "./xlsx.ts";
import { makeDocumentFixture } from "../../../test/helpers/fixtures/document.ts";

const fixture = makeDocumentFixture();
afterAll(() => fixture.remove());

/** Write a real workbook with the given sheet name → rows, returning its bytes. */
async function buildXlsx(sheets: Record<string, unknown[][]>): Promise<Uint8Array> {
	const workbook = new Workbook();
	for (const [name, rows] of Object.entries(sheets)) {
		const worksheet = workbook.addWorksheet(name);
		for (const row of rows) worksheet.addRow(row);
	}
	const buffer = await workbook.xlsx.writeBuffer();
	return new Uint8Array(buffer as ArrayBuffer);
}

describe("cellToText", () => {
	const cases: ReadonlyArray<readonly [string, unknown, string]> = [
		["empty for null", null, ""],
		["empty for undefined", undefined, ""],
		["keeps a string", "hello", "hello"],
		["trims a string", "  hi  ", "hi"],
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
						["1", "2"],
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

describe("extractXlsxText", () => {
	test("reads every non-empty sheet and rebuilds [Sheet] + tab rows", async () => {
		const bytes = await buildXlsx({
			One: [
				["a", "b"],
				[1, 2],
			],
			Two: [["z"]],
		});
		const path = fixture.write("read.xlsx", bytes);
		expect(await extractXlsxText({ path })).toBe("[One]\na\tb\n1\t2\n\n[Two]\nz");
	});

	test("uses a formula's computed value as its displayed text", async () => {
		const bytes = await buildXlsx({ Calc: [["1", "2", { formula: "A1+B1", result: 3 }]] });
		const path = fixture.write("calc.xlsx", bytes);
		expect(await extractXlsxText({ path })).toBe("[Calc]\n1\t2\t3");
	});

	test("propagates a parse error for a file that is not a workbook", async () => {
		const path = fixture.write("bad.xlsx", "not a zip");
		await expect(extractXlsxText({ path })).rejects.toThrow();
	});
});

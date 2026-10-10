import { describe, expect, test } from "bun:test";
import type { DocCli } from "./cli.ts";
import { cellToText, extractXlsxText, parseCsv, parseSheetList, sheetsToText } from "./xlsx.ts";

/** A fake CLI driven by a handler, recording every call. */
function fakeCli(handler: (cli: string, args: string[]) => string): {
	cli: DocCli;
	calls: Array<{ cli: string; args: string[] }>;
} {
	const calls: Array<{ cli: string; args: string[] }> = [];
	return {
		calls,
		cli: {
			run: async (cli, args) => {
				calls.push({ cli, args: [...args] });
				return handler(cli, args);
			},
		},
	};
}

describe("parseSheetList", () => {
	test("reads names and used ranges", () => {
		expect(parseSheetList(JSON.stringify({ sheets: [{ name: "A", usedRange: "A1:B2" }, { name: "B" }] }))).toEqual([
			{ name: "A", usedRange: "A1:B2" },
			{ name: "B", usedRange: undefined },
		]);
	});

	test("ignores entries without a string name", () => {
		expect(parseSheetList(JSON.stringify({ sheets: [{ usedRange: "A1" }, { name: 1 }] }))).toEqual([]);
	});

	test("returns nothing for a document with no sheets", () => {
		expect(parseSheetList(JSON.stringify({ sheets: [] }))).toEqual([]);
	});

	test("throws on invalid JSON", () => {
		expect(() => parseSheetList("nope")).toThrow(/valid JSON/);
	});

	test("throws when the sheet list is missing", () => {
		expect(() => parseSheetList("{}")).toThrow(/sheet list/);
	});
});

describe("parseCsv", () => {
	test("splits plain rows and drops the final newline", () => {
		expect(parseCsv("a,b\n1,2\n")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	test("keeps a quoted comma", () => {
		expect(parseCsv('"a,b",c\n')).toEqual([["a,b", "c"]]);
	});

	test("unescapes doubled quotes", () => {
		expect(parseCsv('"a""b"\n')).toEqual([['a"b']]);
	});

	test("keeps newlines inside quotes", () => {
		expect(parseCsv('"a\nb",c\n')).toEqual([["a\nb", "c"]]);
	});

	test("handles CRLF and a missing final newline", () => {
		expect(parseCsv("a,b\r\n1,2")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	test("returns no rows for empty input", () => {
		expect(parseCsv("")).toEqual([]);
	});
});

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
	test("reads each non-empty sheet and rebuilds [Sheet] + tab rows", async () => {
		const info = JSON.stringify({
			sheets: [
				{ name: "One", usedRange: "A1:B2" },
				{ name: "Empty", usedRange: null },
				{ name: "Two", usedRange: "A1:A1" },
			],
		});
		const { cli, calls } = fakeCli((_cli, args) => {
			if (args[0] === "info") return info;
			if (args[3] === "One") return "a,b\n1,2\n";
			if (args[3] === "Two") return "z\n";
			return "";
		});

		const text = await extractXlsxText({ path: "/root/a.xlsx" }, cli);
		expect(text).toBe("[One]\na\tb\n1\t2\n\n[Two]\nz");
		expect(calls).toEqual([
			{ cli: "gridcraft-cli", args: ["info", "/root/a.xlsx", "--json"] },
			{ cli: "gridcraft-cli", args: ["cat", "/root/a.xlsx", "--sheet", "One", "--csv"] },
			{ cli: "gridcraft-cli", args: ["cat", "/root/a.xlsx", "--sheet", "Two", "--csv"] },
		]);
	});

	test("propagates a CLI failure", async () => {
		const cli: DocCli = {
			run: async () => {
				throw new Error("boom");
			},
		};
		await expect(extractXlsxText({ path: "/root/a.xlsx" }, cli)).rejects.toThrow("boom");
	});
});

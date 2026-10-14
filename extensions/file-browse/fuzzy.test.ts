import { describe, expect, test } from "bun:test";
import { fuzzyMatch, fuzzySearch } from "./fuzzy.ts";

describe("fuzzyMatch", () => {
	test("matches a subsequence and returns its positions", () => {
		expect(fuzzyMatch("rme", "README.md")?.positions).toEqual([0, 4, 5]);
	});

	test("is case-insensitive but rewards exact case", () => {
		expect(fuzzyMatch("readme", "README.md")).toBeDefined();
		const exact = fuzzyMatch("R", "README.md");
		const loose = fuzzyMatch("r", "README.md");
		expect(exact && loose && exact.score > loose.score).toBe(true);
	});

	test("returns undefined when the query is not a subsequence", () => {
		expect(fuzzyMatch("zzz", "README.md")).toBeUndefined();
		expect(fuzzyMatch("mer", "README.md")).toBeUndefined();
	});

	test("an empty query matches with no positions", () => {
		expect(fuzzyMatch("", "a.ts")).toEqual({ score: 0, positions: [] });
	});

	test("treats an over-long query as no match", () => {
		expect(fuzzyMatch("a".repeat(300), "a".repeat(300))).toBeUndefined();
	});
});

describe("fuzzySearch", () => {
	test("ranks a basename match above a directory match", () => {
		const results = fuzzySearch("readme", ["readme/something.ts", "src/readme.ts"], 10);
		expect(results[0]?.path).toBe("src/readme.ts");
	});

	test("returns nothing for an empty query", () => {
		expect(fuzzySearch("", ["a.ts"], 10)).toEqual([]);
		expect(fuzzySearch("   ", ["a.ts"], 10)).toEqual([]);
	});

	test("caps results and preserves matched positions", () => {
		const paths = Array.from({ length: 10 }, (_, index) => `file-${index}.ts`);
		const results = fuzzySearch("file", paths, 3);
		expect(results).toHaveLength(3);
		expect(results[0]?.positions).toEqual([0, 1, 2, 3]);
	});
});

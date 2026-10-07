import { describe, expect, test } from "bun:test";
import { findPassages, toCodePointOffset, type FindOptions } from "../../extensions/web-fetch/find.ts";

const options = (overrides: Partial<FindOptions> = {}): FindOptions => ({
	mode: "insensitive",
	contextChars: 200,
	maxMatches: 8,
	...overrides,
});

describe("toCodePointOffset", () => {
	test("counts astral characters once", () => {
		expect(toCodePointOffset("a😀b", 0)).toBe(0);
		expect(toCodePointOffset("a😀b", 3)).toBe(2);
	});
});

describe("findPassages", () => {
	test("exact mode is case-sensitive", () => {
		expect(findPassages("Alpha alpha", ["Alpha"], options({ mode: "exact" }))).toHaveLength(1);
		expect(findPassages("Alpha alpha", ["alpha"], options({ mode: "exact" }))).toHaveLength(1);
	});

	test("insensitive mode matches any case", () => {
		const matches = findPassages("Alpha alpha", ["ALPHA"], options());
		expect(matches.map((m) => m.offset)).toEqual([0, 6]);
	});

	test("reports CJK offsets in code points", () => {
		const matches = findPassages("你好广州早茶文化", ["早茶"], options());
		expect(matches).toHaveLength(1);
		expect(matches[0].offset).toBe(4);
	});

	test("clips context with ellipses", () => {
		const [match] = findPassages("xxxMATCHyyy", ["MATCH"], options({ contextChars: 2 }));
		expect(match.passage).toBe("…xxMATCHyy…");
	});

	test("respects maxMatches", () => {
		expect(findPassages("a a a a a", ["a"], options({ contextChars: 0, maxMatches: 2 }))).toHaveLength(2);
	});

	test("handles multiple queries", () => {
		const matches = findPassages("one two three", ["one", "three"], options({ contextChars: 0 }));
		expect(matches.map((m) => m.query)).toEqual(["one", "three"]);
	});

	test("fuzzy mode ranks lines by term coverage", () => {
		const text = "the quick brown fox\nlazy dog sleeps\nbrown fox jumps";
		const matches = findPassages(text, ["brown fox"], options({ mode: "fuzzy" }));
		expect(matches).toHaveLength(2);
		expect(matches[0].offset).toBe(0);
		expect(matches[0].passage).toContain("brown fox");
	});

	test("fuzzy mode splits spaceless CJK queries into characters", () => {
		const matches = findPassages("广州早茶文化", ["早茶"], options({ mode: "fuzzy" }));
		expect(matches.length).toBeGreaterThan(0);
	});

	test("returns nothing when the query is absent", () => {
		expect(findPassages("hello world", ["missing"], options())).toEqual([]);
	});
});

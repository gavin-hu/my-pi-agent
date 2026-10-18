import { describe, expect, test } from "bun:test";
import { charLength, sliceChars, truncateChars } from "./text.ts";

describe("charLength", () => {
	test("counts code points, not UTF-16 units", () => {
		expect(charLength("hello")).toBe(5);
		expect(charLength("广州早茶")).toBe(4);
		expect(charLength("👍🏽")).toBe(2); // thumbs up + skin tone modifier
	});
});

describe("sliceChars", () => {
	test("slices by code point", () => {
		expect(sliceChars("a👍b", 0, 2)).toBe("a👍");
		expect(sliceChars("a👍b", 1, 3)).toBe("👍b");
		expect(sliceChars("广州早茶", 1, 3)).toBe("州早");
	});

	test("clamps and defaults to the end", () => {
		expect(sliceChars("abc", 0)).toBe("abc");
		expect(sliceChars("abc", 2)).toBe("c");
		expect(sliceChars("abc", 0, 10)).toBe("abc");
		expect(sliceChars("abc", 10)).toBe("");
		expect(sliceChars("abc", -2, 1)).toBe("a");
	});

	test("never splits a surrogate pair", () => {
		expect(sliceChars("👍🏽", 0, 1)).toBe("👍");
		expect(sliceChars("👍🏽", 1)).toBe("🏽");
	});
});

describe("truncateChars", () => {
	test("returns short text unchanged", () => {
		expect(truncateChars("hello", 10)).toBe("hello");
	});

	test("appends the marker and stays within the budget", () => {
		const result = truncateChars("abcdefghij", 5);
		expect(result).toBe("abcd…");
		expect(charLength(result)).toBe(5);
	});

	test("keeps CJK well-formed", () => {
		const result = truncateChars("广州早茶文化", 4);
		expect(result).toBe("广州早…");
		expect(charLength(result)).toBe(4);
	});

	test("returns just the marker when there is no room", () => {
		expect(truncateChars("abcdef", 1)).toBe("…");
		expect(truncateChars("abcdef", 0)).toBe("…");
	});
});

import { describe, expect, test } from "bun:test";
import { formatDoc } from "./paging.ts";

const base = { path: "a.pdf", format: "pdf" as const, bytes: 100 };

describe("formatDoc", () => {
	test("returns the whole text when it fits and notes the header", () => {
		const page = formatDoc({ ...base, text: "hello", startIndex: 0, maxChars: 200 });
		expect(page.body).toBe("hello");
		expect(page.truncated).toBe(false);
		expect(page.nextIndex).toBe(5);
		expect(page.chars).toBe(5);
		expect(page.text).toContain("Path: a.pdf");
	});

	test("slices by code point and names the next index", () => {
		const page = formatDoc({ ...base, text: "a😀b😀c", startIndex: 1, maxChars: 3 });
		expect(page.body).toBe("😀b😀");
		expect(page.nextIndex).toBe(4);
		expect(page.truncated).toBe(true);
		expect(page.text).toContain("startIndex=4");
	});

	test("reports an empty document", () => {
		const page = formatDoc({ ...base, text: "", startIndex: 0, maxChars: 200 });
		expect(page.body).toBe("");
		expect(page.chars).toBe(0);
		expect(page.text).toContain("no extractable text");
	});

	test("reports a startIndex past the end", () => {
		const page = formatDoc({ ...base, text: "abc", startIndex: 10, maxChars: 200 });
		expect(page.body).toBe("");
		expect(page.nextIndex).toBe(3);
		expect(page.text).toContain("no text at startIndex 10");
	});
});

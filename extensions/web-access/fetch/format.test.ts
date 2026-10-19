import { describe, expect, test } from "bun:test";
import { formatMatches, formatPage } from "./format.ts";
import type { Passage } from "./find.ts";

function input(overrides: Partial<Parameters<typeof formatPage>[0]> = {}) {
	return {
		finalUrl: "https://example.com/",
		title: "Example",
		status: 200,
		contentType: "text/html",
		text: "hello world",
		startIndex: 0,
		maxChars: 100,
		...overrides,
	};
}

function matchInput(overrides: Partial<Parameters<typeof formatMatches>[0]> = {}) {
	const passage = (offset: number): Passage => ({
		query: "hit",
		offset,
		passage: `${"x".repeat(190)}hit${offset}${"y".repeat(190)}`,
	});
	return {
		finalUrl: "https://example.com/",
		title: "Example",
		status: 200,
		contentType: "text/html",
		matches: [0, 1, 2].map((index) => passage(index * 100)),
		find: ["hit"],
		maxChars: 20_000,
		cappedByMaxMatches: false,
		...overrides,
	};
}

describe("formatMatches", () => {
	test("renders every passage when they fit", () => {
		const result = formatMatches(matchInput());
		expect(result.included).toHaveLength(3);
		expect(result.truncated).toBe(false);
		expect(result.text).toContain("1. [offset 0]");
		expect(result.body.split("\n\n")).toHaveLength(3);
	});

	test("stops at the character budget and names it", () => {
		const result = formatMatches(matchInput({ maxChars: 1200 }));
		expect(result.included.length).toBeLessThan(3);
		expect(result.truncated).toBe(true);
		expect(Array.from(result.text).length).toBeLessThanOrEqual(1200);
		expect(result.text).toContain(`showing ${result.included.length} of 3 matches within 1200 characters`);
		expect(result.text).toContain("lower contextChars");
	});

	test("names the match cap when the budget is not what limited it", () => {
		const result = formatMatches(matchInput({ matches: matchInput().matches.slice(0, 2), cappedByMaxMatches: true }));
		expect(result.truncated).toBe(true);
		expect(result.text).toContain("raise maxMatches");
	});

	test("still returns a passage when a single one is larger than the budget", () => {
		const result = formatMatches(matchInput({ maxChars: 400 }));
		expect(result.included).toHaveLength(1);
		expect(Array.from(result.text).length).toBeLessThanOrEqual(400);
		expect(result.text).toContain("[offset 0]");
	});

	test("reports no matches", () => {
		const result = formatMatches(matchInput({ matches: [] }));
		expect(result.text).toContain("No matches.");
		expect(result.truncated).toBe(false);
	});
});

describe("formatPage", () => {
	test("renders a header and the body", () => {
		const result = formatPage(input());
		expect(result.text).toContain("Title: Example");
		expect(result.text).toContain("URL: https://example.com/");
		expect(result.text).toContain("Status: 200 (text/html)");
		expect(result.body).toBe("hello world");
		expect(result.truncated).toBe(false);
		expect(result.nextIndex).toBe(0);
	});

	test("slices and reports the next index when truncated", () => {
		const result = formatPage(input({ text: "0123456789", startIndex: 0, maxChars: 200 }));
		expect(result.body).toBe("0123456789");
		expect(result.truncated).toBe(false);

		const paged = formatPage(input({ text: "0123456789".repeat(100), startIndex: 0, maxChars: 200 }));
		expect(paged.truncated).toBe(true);
		expect(paged.text).toContain(`startIndex=${paged.nextIndex}`);
	});

	test("keeps the truncation hint inside the budget", () => {
		const result = formatPage(input({ text: "x".repeat(10_000), startIndex: 0, maxChars: 500 }));
		expect(result.truncated).toBe(true);
		expect(Array.from(result.text).length).toBeLessThanOrEqual(500);
		expect(result.text).toContain(`call web_fetch again with startIndex=${result.nextIndex}`);
	});

	test("continues from startIndex", () => {
		const text = "0123456789".repeat(100);
		const first = formatPage(input({ text, startIndex: 0, maxChars: 200 }));
		const second = formatPage(input({ text, startIndex: first.nextIndex, maxChars: 200 }));
		expect(second.body).toBe(
			Array.from(text)
				.slice(first.nextIndex, first.nextIndex + second.body.length)
				.join(""),
		);
		expect(second.nextIndex).toBeGreaterThan(first.nextIndex);
	});

	test("is code-point safe for CJK", () => {
		const text = "广州早茶文化".repeat(200);
		const result = formatPage(input({ text, startIndex: 0, maxChars: 200 }));
		expect(result.body).toBe(Array.from(text).slice(0, Array.from(result.body).length).join(""));
		expect(result.truncated).toBe(true);
	});

	test("reports when startIndex is past the end", () => {
		const result = formatPage(input({ text: "abc", startIndex: 10 }));
		expect(result.body).toBe("");
		expect(result.text).toContain("no text at startIndex 10");
	});

	test("reports an empty page", () => {
		const result = formatPage(input({ text: "" }));
		expect(result.text).toContain("(no readable text)");
	});

	test("omits the title line when there is no title", () => {
		const result = formatPage(input({ title: "" }));
		expect(result.text).not.toContain("Title:");
	});
});

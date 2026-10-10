import { describe, expect, test } from "bun:test";
import { formatBatch, formatPage } from "./format.ts";

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

describe("formatBatch", () => {
	test("joins sections under a heading per url", () => {
		const result = formatBatch(
			[
				{ url: "https://a/", text: "Title: A\n\nbody a" },
				{ url: "https://b/", text: "ERROR: HTTP 404" },
			],
			10_000,
		);
		expect(result.text).toContain("### https://a/\nTitle: A");
		expect(result.text).toContain("### https://b/\nERROR: HTTP 404");
		expect(result.text).not.toContain("showing");
	});

	test("drops whole sections with a count instead of cutting one mid-way", () => {
		const result = formatBatch(
			[
				{ url: "https://a/", text: "A".repeat(50) },
				{ url: "https://b/", text: "B".repeat(50) },
			],
			80,
		);
		expect(result.text).toContain("### https://a/");
		expect(result.text).not.toContain("### https://b/");
		expect(result.text).toContain("(showing 1 of 2 pages)");
	});

	test("keeps a single over-budget section rather than returning nothing", () => {
		const result = formatBatch([{ url: "https://a/", text: "A".repeat(500) }], 20);
		expect(result.text).toContain("### https://a/");
		expect(result.text).not.toContain("showing");
	});
});

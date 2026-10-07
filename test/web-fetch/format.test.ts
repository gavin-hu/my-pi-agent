import { describe, expect, test } from "bun:test";
import { formatPage } from "../../extensions/web-fetch/format.ts";

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
		expect(result.header).toContain("Title: Example");
		expect(result.header).toContain("URL: https://example.com/");
		expect(result.header).toContain("Status: 200 (text/html)");
		expect(result.body).toBe("hello world");
		expect(result.truncated).toBe(false);
		expect(result.text).toContain("hello world");
	});

	test("slices and reports the next index when truncated", () => {
		const result = formatPage(input({ text: "0123456789", startIndex: 0, maxChars: 4 }));
		expect(result.body).toBe("0123");
		expect(result.truncated).toBe(true);
		expect(result.nextIndex).toBe(4);
		expect(result.text).toContain("startIndex=4");
	});

	test("continues from startIndex", () => {
		const result = formatPage(input({ text: "0123456789", startIndex: 4, maxChars: 4 }));
		expect(result.body).toBe("4567");
		expect(result.nextIndex).toBe(8);
	});

	test("is code-point safe for CJK", () => {
		const text = "广州早茶文化".repeat(10);
		const result = formatPage(input({ text, startIndex: 0, maxChars: 5 }));
		expect(Array.from(result.body)).toHaveLength(5);
		expect(result.body).toBe("广州早茶文");
		expect(result.nextIndex).toBe(5);
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
		expect(result.header).not.toContain("Title:");
	});
});

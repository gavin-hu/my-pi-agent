import { describe, expect, test } from "bun:test";
import { formatDoc, summarizeDoc } from "./paging.ts";

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

	test("names the document rather than assuming a scanned PDF", () => {
		const page = formatDoc({ ...base, format: "docx", text: "", startIndex: 0, maxChars: 200 });
		expect(page.text).toContain("no extractable text");
		expect(page.text).not.toContain("PDF");
	});
});

describe("summarizeDoc", () => {
	const summaryBase = { path: "a.pdf", format: "pdf" as const, chars: 42478, startIndex: 0 };

	test("shows the total for a complete first read", () => {
		const summary = summarizeDoc({ ...summaryBase, nextIndex: 42478, truncated: false });
		expect(summary.detail).toBe("pdf · 42478 chars");
		expect(summary.note).toBeUndefined();
	});

	test("shows the returned range and where to continue when truncated", () => {
		const summary = summarizeDoc({ ...summaryBase, nextIndex: 40000, truncated: true });
		expect(summary.detail).toBe("pdf · 1–40000 of 42478 chars");
		expect(summary.note).toBe("more at 40000");
	});

	test("marks a non-first final page complete", () => {
		const summary = summarizeDoc({ ...summaryBase, startIndex: 40000, nextIndex: 42478, truncated: false });
		expect(summary.detail).toBe("pdf · 40001–42478 of 42478 chars");
		expect(summary.note).toBe("complete");
	});

	test("reports an out-of-range startIndex without a bogus range", () => {
		const summary = summarizeDoc({
			path: "a.pdf",
			format: "pdf",
			chars: 3,
			startIndex: 10,
			nextIndex: 3,
			truncated: false,
		});
		expect(summary.detail).toBe("pdf · no text at 10 of 3 chars");
		expect(summary.note).toBeUndefined();
	});

	test("reports an empty document", () => {
		const summary = summarizeDoc({
			path: "a.pdf",
			format: "pdf",
			chars: 0,
			startIndex: 0,
			nextIndex: 0,
			truncated: false,
		});
		expect(summary.detail).toBe("pdf · 0 chars");
		expect(summary.note).toBeUndefined();
	});
});

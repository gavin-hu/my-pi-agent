import { describe, expect, test } from "bun:test";
import { formatResults } from "../../extensions/web-search/format.ts";
import type { SearchResponse } from "../../extensions/web-search/types.ts";

function response(results: SearchResponse["results"], query = "pi agent"): SearchResponse {
	return { query, provider: "duckduckgo", results, truncated: false, fetchedAt: "2026-01-01T00:00:00.000Z" };
}

describe("formatResults", () => {
	test("renders numbered blocks with url and snippet", () => {
		const { text, truncated } = formatResults(
			response([
				{ title: "First", url: "https://a.example/", snippet: "Alpha" },
				{ title: "Second", url: "https://b.example/", snippet: "" },
			]),
			10_000,
		);
		expect(text).toContain('DuckDuckGo results for "pi agent"');
		expect(text).toContain("1. First\n   https://a.example/\n   Alpha");
		expect(text).toContain("2. Second\n   https://b.example/");
		expect(truncated).toBe(false);
	});

	test("reports no results without a heading list", () => {
		const { text, truncated } = formatResults(response([]), 10_000);
		expect(text).toBe('DuckDuckGo results for "pi agent": no results.');
		expect(truncated).toBe(false);
	});

	test("drops whole blocks that do not fit and notes the count", () => {
		const { text, truncated } = formatResults(
			response([
				{ title: "First", url: "https://a.example/", snippet: "x".repeat(40) },
				{ title: "Second", url: "https://b.example/", snippet: "y".repeat(40) },
			]),
			160,
		);
		expect(truncated).toBe(true);
		expect(text).toContain("1. First");
		expect(text).not.toContain("Second");
		expect(text).toContain("(showing 1 of 2 results)");
	});

	test("hard-truncates by code point and keeps CJK well-formed", () => {
		const { text, truncated } = formatResults(
			response([{ title: "中文标题", url: "https://example.cn/", snippet: "一段很长的中文摘要".repeat(20) }]),
			60,
		);
		expect(truncated).toBe(true);
		expect(Array.from(text).length).toBeLessThanOrEqual(60);
		expect(text.endsWith("…")).toBe(true);
	});
});

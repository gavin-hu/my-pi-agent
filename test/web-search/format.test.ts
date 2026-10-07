import { describe, expect, test } from "bun:test";
import { formatResults } from "../../extensions/web-search/format.ts";
import type { SearchResponse } from "../../extensions/web-search/types.ts";

function response(overrides: Partial<SearchResponse>): SearchResponse {
	return {
		query: "pi agent",
		provider: "duckduckgo",
		answer: "",
		results: [],
		truncated: false,
		fetchedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("formatResults", () => {
	test("renders an instant answer and numbered results", () => {
		const { text, truncated } = formatResults(
			response({
				answer: "Pi is a minimal agent harness — pi.dev (https://pi.dev/)",
				results: [
					{ title: "Pi", url: "https://pi.dev/", snippet: "A harness." },
					{ title: "GitHub", url: "https://github.com/earendil-works/pi", snippet: "" },
				],
			}),
			10_000,
		);
		expect(text).toContain('DuckDuckGo instant answer for "pi agent"');
		expect(text).toContain("Answer: Pi is a minimal agent harness");
		expect(text).toContain("1. Pi\n   https://pi.dev/\n   A harness.");
		expect(text).toContain("2. GitHub\n   https://github.com/earendil-works/pi");
		expect(truncated).toBe(false);
	});

	test("labels Wikipedia results", () => {
		const { text } = formatResults(
			response({ provider: "wikipedia", results: [{ title: "广州", url: "https://zh.wikipedia.org/wiki/广州", snippet: "城市" }] }),
			10_000,
		);
		expect(text).toContain('Wikipedia results for "pi agent"');
		expect(text).toContain("1. 广州");
	});

	test("explains an empty result and points at web_fetch", () => {
		const { text, truncated } = formatResults(response({ provider: "none" }), 10_000);
		expect(text).toContain("No instant answer or Wikipedia results");
		expect(text).toContain("web_fetch");
		expect(truncated).toBe(false);
	});

	test("drops whole blocks that do not fit and notes the count", () => {
		const { text, truncated } = formatResults(
			response({
				results: [
					{ title: "First", url: "https://a.example/", snippet: "x".repeat(40) },
					{ title: "Second", url: "https://b.example/", snippet: "y".repeat(40) },
				],
			}),
			180,
		);
		expect(truncated).toBe(true);
		expect(text).toContain("1. First");
		expect(text).not.toContain("Second");
		expect(text).toContain("(showing 1 of 2 results)");
	});

	test("hard-truncates by code point and keeps CJK well-formed", () => {
		const { text, truncated } = formatResults(
			response({ results: [{ title: "中文标题", url: "https://example.cn/", snippet: "一段很长的中文摘要".repeat(20) }] }),
			60,
		);
		expect(truncated).toBe(true);
		expect(Array.from(text).length).toBeLessThanOrEqual(60);
		expect(text.endsWith("…")).toBe(true);
	});
});

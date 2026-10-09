import { describe, expect, test } from "bun:test";
import { buildSearxngUrl, parseSearxng, searxngLanguageFor } from "./searxng.ts";

describe("searxngLanguageFor", () => {
	test("auto picks en for Latin text", () => {
		expect(searxngLanguageFor("pi agent", "auto")).toBe("en");
	});

	test("auto picks zh-CN for Han text", () => {
		expect(searxngLanguageFor("广州 早茶", "auto")).toBe("zh-CN");
	});

	test("an explicit code passes through", () => {
		expect(searxngLanguageFor("广州 早茶", "de")).toBe("de");
	});
});

describe("buildSearxngUrl", () => {
	test("sets the query, format, and filters", () => {
		const url = buildSearxngUrl("https://searx.example", {
			query: "pi agent",
			language: "en",
			categories: "general",
			safeSearch: 1,
		});
		expect(url.pathname).toBe("/search");
		expect(url.searchParams.get("q")).toBe("pi agent");
		expect(url.searchParams.get("format")).toBe("json");
		expect(url.searchParams.get("categories")).toBe("general");
		expect(url.searchParams.get("language")).toBe("en");
		expect(url.searchParams.get("safesearch")).toBe("1");
	});

	test("tolerates a trailing slash on the endpoint", () => {
		const url = buildSearxngUrl("https://searx.example/", {
			query: "x",
			language: "en",
			categories: "general",
			safeSearch: 0,
		});
		expect(url.pathname).toBe("/search");
	});

	test("tolerates an endpoint with a path", () => {
		const url = buildSearxngUrl("https://host.example/searxng", {
			query: "x",
			language: "en",
			categories: "general",
			safeSearch: 0,
		});
		expect(url.pathname).toBe("/searxng/search");
	});
});

describe("parseSearxng", () => {
	test("maps results and the first answer, de-duplicating by URL", () => {
		const parsed = parseSearxng(
			{
				answers: ["42"],
				results: [
					{ title: "A", url: "https://a.example/", content: "alpha" },
					{ title: "A again", url: "https://a.example/", content: "dup" },
					{ title: "B", url: "https://b.example/", content: "" },
				],
			},
			10,
		);
		expect(parsed.answer).toBe("42");
		expect(parsed.results).toEqual([
			{ title: "A", url: "https://a.example/", snippet: "alpha" },
			{ title: "B", url: "https://b.example/", snippet: "" },
		]);
	});

	test("caps results at maxResults", () => {
		const results = Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, url: `https://x/${i}`, content: "" }));
		expect(parseSearxng({ results }, 3).results).toHaveLength(3);
	});

	test("skips entries missing a title or url", () => {
		const parsed = parseSearxng(
			{ results: [{ url: "https://a.example/" }, { title: "B" }, { title: "C", url: "https://c.example/" }] },
			10,
		);
		expect(parsed.results).toEqual([{ title: "C", url: "https://c.example/", snippet: "" }]);
	});

	test("handles missing and non-object input", () => {
		expect(parseSearxng(undefined, 10)).toEqual({ answer: "", results: [] });
		expect(parseSearxng("nope", 10)).toEqual({ answer: "", results: [] });
		expect(parseSearxng({ answers: [1, ""], results: "nope" }, 10)).toEqual({ answer: "", results: [] });
	});
});

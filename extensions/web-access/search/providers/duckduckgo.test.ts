import { describe, expect, test } from "bun:test";
import { DEFAULT_SEARCH_CONFIG } from "../config.ts";
import type { HttpRunner } from "../../http.ts";
import { HttpUnavailableError } from "../../http.ts";
import {
	buildDuckDuckGoUrl,
	parseDuckDuckGo,
	sanitizeText,
	searchDuckDuckGo,
	splitTitleAndSnippet,
} from "./duckduckgo.ts";
import { jsonResponse } from "../../../../test/helpers/fixtures/web-access.ts";

describe("buildDuckDuckGoUrl", () => {
	test("sets the query and the JSON/plain-text flags", () => {
		const url = buildDuckDuckGoUrl("pi agent");
		expect(url.host).toBe("api.duckduckgo.com");
		expect(url.searchParams.get("q")).toBe("pi agent");
		expect(url.searchParams.get("format")).toBe("json");
		expect(url.searchParams.get("no_html")).toBe("1");
		expect(url.searchParams.get("skip_disambig")).toBe("1");
	});
});

describe("sanitizeText", () => {
	test("strips tags, decodes entities, and collapses whitespace", () => {
		expect(sanitizeText("<b>Pi</b>&nbsp; is &amp; <i>a</i>\n harness")).toBe("Pi is & a harness");
	});

	test("leaves quotes and apostrophes intact", () => {
		expect(sanitizeText("&quot;Pi&#39;s&quot;")).toBe('"Pi\'s"');
	});
});

describe("splitTitleAndSnippet", () => {
	test("uses the anchor text as the title and the rest as the snippet", () => {
		expect(splitTitleAndSnippet('<a href="https://x/">Pi</a>A harness.')).toEqual({
			title: "Pi",
			snippet: "A harness.",
		});
	});

	test("falls back to the whole text when there is no anchor", () => {
		expect(splitTitleAndSnippet("Plain text")).toEqual({ title: "Plain text", snippet: "" });
	});
});

describe("parseDuckDuckGo", () => {
	test("prefers Answer, then AbstractText, then Definition", () => {
		expect(parseDuckDuckGo({ Answer: "42", AbstractText: "abs", Definition: "def" }, 5).answer).toBe("42");
		expect(parseDuckDuckGo({ AbstractText: "abs", Definition: "def" }, 5).answer).toBe("abs");
		expect(parseDuckDuckGo({ Definition: "def" }, 5).answer).toBe("def");
	});

	test("maps Results and flattens nested RelatedTopics", () => {
		const parsed = parseDuckDuckGo(
			{
				Results: [{ FirstURL: "https://a.example/", Text: '<a href="https://a.example/">A</a>alpha' }],
				RelatedTopics: [
					{ FirstURL: "https://b.example/", Text: '<a href="https://b.example/">B</a>beta' },
					{
						Name: "Group",
						Topics: [{ FirstURL: "https://c.example/", Text: '<a href="https://c.example/">C</a>gamma' }],
					},
				],
			},
			10,
		);
		expect(parsed.results).toEqual([
			{ title: "A", url: "https://a.example/", snippet: "alpha" },
			{ title: "B", url: "https://b.example/", snippet: "beta" },
			{ title: "C", url: "https://c.example/", snippet: "gamma" },
		]);
	});

	test("drops non-http URLs and duplicates, and caps at maxResults", () => {
		const parsed = parseDuckDuckGo(
			{
				RelatedTopics: [
					{ FirstURL: "https://a.example/", Text: "A" },
					{ FirstURL: "https://a.example/", Text: "A again" },
					{ FirstURL: "ftp://bad.example/", Text: "Bad" },
					{ FirstURL: "https://b.example/", Text: "B" },
				],
			},
			1,
		);
		expect(parsed.results).toEqual([{ title: "A", url: "https://a.example/", snippet: "" }]);
	});

	test("handles missing and non-object input", () => {
		expect(parseDuckDuckGo(undefined, 5)).toEqual({ answer: "", results: [] });
		expect(parseDuckDuckGo("nope", 5)).toEqual({ answer: "", results: [] });
		expect(parseDuckDuckGo({ RelatedTopics: "nope" }, 5)).toEqual({ answer: "", results: [] });
	});
});

describe("searchDuckDuckGo", () => {
	const config = DEFAULT_SEARCH_CONFIG;

	test("parses a JSON response", async () => {
		const runner: HttpRunner = () =>
			Promise.resolve(jsonResponse({ Answer: "42", RelatedTopics: [{ FirstURL: "https://x/", Text: "X" }] }));
		const result = await searchDuckDuckGo("q", 5, config, runner, undefined);
		expect(result.answer).toBe("42");
		expect(result.results).toHaveLength(1);
	});

	test("throws on a non-2xx response", async () => {
		const runner: HttpRunner = () => Promise.resolve(jsonResponse("nope", 503));
		await expect(searchDuckDuckGo("q", 5, config, runner, undefined)).rejects.toThrow(HttpUnavailableError);
	});

	test("throws on invalid JSON", async () => {
		const runner: HttpRunner = () =>
			Promise.resolve({ status: 200, body: "<html>", contentType: "text/html", finalUrl: "", sizeBytes: 6 });
		await expect(searchDuckDuckGo("q", 5, config, runner, undefined)).rejects.toThrow("invalid JSON");
	});
});

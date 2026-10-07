import { describe, expect, test } from "bun:test";
import { createFetchRunner } from "../../extensions/web-search/http.ts";
import { parseInstantAnswer, searchInstantAnswer } from "../../extensions/web-search/instant-answer.ts";

const SAMPLE = {
	Heading: "Pi",
	AbstractText: "Pi is a minimal agent harness.",
	AbstractSource: "Wikipedia",
	AbstractURL: "https://en.wikipedia.org/wiki/Pi",
	Answer: "",
	Definition: "",
	Results: [{ FirstURL: "https://a.example/", Text: "Alpha - first" }],
	RelatedTopics: [
		{ FirstURL: "https://b.example/", Text: "Beta" },
		{
			Name: "Group",
			Topics: [
				{ FirstURL: "https://c.example/", Text: "Gamma - third" },
				{ FirstURL: "https://a.example/", Text: "Alpha duplicate" },
			],
		},
	],
};

describe("parseInstantAnswer", () => {
	test("uses the abstract as the answer and flattens topics", () => {
		const instant = parseInstantAnswer(SAMPLE);
		expect(instant.answer).toBe("Pi is a minimal agent harness.");
		expect(instant.source).toBe("Wikipedia");
		expect(instant.url).toBe("https://en.wikipedia.org/wiki/Pi");
		expect(instant.results.map((r) => r.title)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(instant.results.map((r) => r.url)).toEqual(["https://a.example/", "https://b.example/", "https://c.example/"]);
	});

	test("prefers Answer over AbstractText over Definition", () => {
		expect(parseInstantAnswer({ Answer: "42", AbstractText: "abstract" }).answer).toBe("42");
		expect(parseInstantAnswer({ Definition: "def" }).answer).toBe("def");
	});

	test("returns an empty answer for an empty response", () => {
		const instant = parseInstantAnswer({});
		expect(instant.answer).toBe("");
		expect(instant.results).toEqual([]);
	});
});

function runnerReturning(body: string, status = 200) {
	const seen: string[] = [];
	const runner = createFetchRunner(((url: string) => {
		seen.push(url);
		return Promise.resolve(new Response(body, { status, headers: { "content-type": "application/json" } }));
	}) as unknown as typeof fetch);
	return { runner, seen };
}

describe("searchInstantAnswer", () => {
	test("builds the query and returns the parsed answer", async () => {
		const { runner, seen } = runnerReturning(JSON.stringify(SAMPLE));
		const instant = await searchInstantAnswer("pi agent", "https://api.duckduckgo.com/", runner, undefined, 1000, 100_000);
		const url = new URL(seen[0]);
		expect(url.searchParams.get("q")).toBe("pi agent");
		expect(url.searchParams.get("format")).toBe("json");
		expect(url.searchParams.get("no_html")).toBe("1");
		expect(url.searchParams.get("skip_disambig")).toBe("1");
		expect(instant?.answer).toBe("Pi is a minimal agent harness.");
	});

	test("returns undefined when there is no answer and no topics", async () => {
		const { runner } = runnerReturning("{}");
		expect(await searchInstantAnswer("x", "https://api.duckduckgo.com/", runner, undefined, 1000, 100_000)).toBeUndefined();
	});

	test("throws on an HTTP error", async () => {
		const { runner } = runnerReturning("nope", 503);
		await expect(searchInstantAnswer("x", "https://api.duckduckgo.com/", runner, undefined, 1000, 100_000)).rejects.toThrow(
			"HTTP 503",
		);
	});

	test("throws on invalid JSON", async () => {
		const { runner } = runnerReturning("<html>not json</html>");
		await expect(searchInstantAnswer("x", "https://api.duckduckgo.com/", runner, undefined, 1000, 100_000)).rejects.toThrow(
			"invalid JSON",
		);
	});
});

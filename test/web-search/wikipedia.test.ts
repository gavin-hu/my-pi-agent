import { describe, expect, test } from "bun:test";
import { createFetchRunner } from "../../extensions/_shared/http.ts";
import { parseWikipedia, searchWikipedia, wikipediaEndpointFor, wikipediaLangFor } from "../../extensions/web-search/wikipedia.ts";

describe("wikipediaLangFor", () => {
	test("picks zh for Han text and en otherwise when auto", () => {
		expect(wikipediaLangFor("python list comprehension", "auto")).toBe("en");
		expect(wikipediaLangFor("广州 早茶", "auto")).toBe("zh");
	});

	test("honours an explicit language", () => {
		expect(wikipediaLangFor("广州 早茶", "fr")).toBe("fr");
	});
});

describe("wikipediaEndpointFor", () => {
	test("substitutes the language placeholder", () => {
		expect(wikipediaEndpointFor("https://{lang}.wikipedia.org/w/api.php", "zh")).toBe("https://zh.wikipedia.org/w/api.php");
	});

	test("leaves a template without a placeholder alone", () => {
		expect(wikipediaEndpointFor("https://wiki.example/api", "en")).toBe("https://wiki.example/api");
	});
});

describe("parseWikipedia", () => {
	test("orders by search index, keeps urls, and de-duplicates", () => {
		const json = {
			query: {
				pages: {
					"2": { title: "Second", fullurl: "https://en.wikipedia.org/wiki/Second", extract: "two", index: 2 },
					"1": { title: "First", fullurl: "https://en.wikipedia.org/wiki/First", extract: "  one\n line  ", index: 1 },
					"3": { title: "Dup", fullurl: "https://en.wikipedia.org/wiki/First", extract: "dup", index: 3 },
					"4": { title: "NoUrl", extract: "x" },
				},
			},
		};
		const results = parseWikipedia(json, 10);
		expect(results.map((r) => r.title)).toEqual(["First", "Second"]);
		expect(results[0].snippet).toBe("one line");
	});

	test("honours the result limit", () => {
		const pages = Object.fromEntries(
			Array.from({ length: 5 }, (_, i) => [String(i), { title: `T${i}`, fullurl: `https://x/${i}`, extract: "e", index: i }]),
		);
		expect(parseWikipedia({ query: { pages } }, 2)).toHaveLength(2);
	});

	test("returns an empty list when there are no pages", () => {
		expect(parseWikipedia({ query: {} }, 5)).toEqual([]);
	});
});

describe("searchWikipedia", () => {
	test("builds the query and returns results", async () => {
		let requested = "";
		const runner = createFetchRunner(((url: string) => {
			requested = url;
			return Promise.resolve(
				new Response(
					JSON.stringify({
						query: { pages: { "1": { title: "广州", fullurl: "https://zh.wikipedia.org/wiki/广州", extract: "城市", index: 1 } } },
					}),
					{ status: 200 },
				),
			);
		}) as unknown as typeof fetch);

		const results = await searchWikipedia("广州 早茶", "zh", 3, "https://{lang}.wikipedia.org/w/api.php", runner, undefined, {
			timeoutMs: 1000,
			maxBytes: 100_000,
			userAgent: "test-agent",
		});

		const url = new URL(requested);
		expect(url.host).toBe("zh.wikipedia.org");
		expect(url.searchParams.get("generator")).toBe("search");
		expect(url.searchParams.get("gsrsearch")).toBe("广州 早茶");
		expect(url.searchParams.get("gsrlimit")).toBe("3");
		expect(url.searchParams.get("explaintext")).toBe("1");
		expect(results).toEqual([{ title: "广州", url: "https://zh.wikipedia.org/wiki/广州", snippet: "城市" }]);
	});

	test("throws on an HTTP error", async () => {
		const runner = createFetchRunner((() => Promise.resolve(new Response("err", { status: 502 }))) as unknown as typeof fetch);
		await expect(
			searchWikipedia("x", "en", 3, "https://{lang}.wikipedia.org/w/api.php", runner, undefined, { timeoutMs: 1000, maxBytes: 100_000 }),
		).rejects.toThrow("HTTP 502");
	});
});

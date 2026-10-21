/**
 * The `web_search` capability: config and key resolution, provider facts,
 * response formatting, the provider registry and its three backends, the
 * throttled orchestrator, the tool surface, and the shared web-text helpers.
 *
 * Providers receive an injected `HttpRunner`, and the throttle clock is
 * injected, so the suite never waits or reaches the network.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { decodeEntities } from "../html.ts";
import { HttpUnavailableError, type HttpRunner } from "../http.ts";
import { charLength, sliceChars, truncateChars } from "../text.ts";
import { oneLine } from "../transcript.ts";
import { makeClock } from "../../../test/helpers/clock.ts";
import { tempDir, useEnv, withEnv } from "../../../test/helpers/env.ts";
import { createFakePi, fakeTheme } from "../../../test/helpers/fakes.ts";
import { jsonResponse } from "../../../test/helpers/fixtures/web-access.ts";
import { DEFAULT_SEARCH_CONFIG, MAX_RESULTS, normalizeSearchConfig, resolveSearchApiKey } from "./config.ts";
import { providerFacts } from "./facts.ts";
import { formatResults } from "./format.ts";
import { buildBraveUrl, parseBrave, searchBrave } from "./providers/brave.ts";
import {
	buildDuckDuckGoUrl,
	parseDuckDuckGo,
	sanitizeText,
	searchDuckDuckGo,
	splitTitleAndSnippet,
} from "./providers/duckduckgo.ts";
import { buildSearxngUrl, parseSearxng, searxngLanguageFor } from "./providers/searxng.ts";
import { DEFAULT_PROVIDER_ID, getProvider, providerLabel, resolveProvider, SEARCH_PROVIDERS } from "./registry.ts";
import type { SearchResponse } from "./schema.ts";
import { createThrottle, runSearch, WebSearchError, type Throttle } from "./search.ts";
import { registerSearchTool, TOOL_NAME } from "./tool.ts";
import { SEARCH_PROVIDER_IDS, type SearchRequest } from "./types.ts";

describe("decodeEntities", () => {
	test("decodes named and numeric entities", () => {
		expect(decodeEntities("A &amp; B &#39;c&#39; &#x2764;")).toBe("A & B 'c' ❤");
	});
});

describe("charLength", () => {
	test("counts code points, not UTF-16 units", () => {
		expect(charLength("hello")).toBe(5);
		expect(charLength("广州早茶")).toBe(4);
		expect(charLength("👍🏽")).toBe(2);
	});
});

describe("sliceChars", () => {
	test("slices by code point", () => {
		expect(sliceChars("a👍b", 0, 2)).toBe("a👍");
		expect(sliceChars("a👍b", 1, 3)).toBe("👍b");
		expect(sliceChars("广州早茶", 1, 3)).toBe("州早");
	});

	test("clamps and defaults to the end", () => {
		expect(sliceChars("abc", 0)).toBe("abc");
		expect(sliceChars("abc", 2)).toBe("c");
		expect(sliceChars("abc", 0, 10)).toBe("abc");
		expect(sliceChars("abc", 10)).toBe("");
		expect(sliceChars("abc", -2, 1)).toBe("a");
	});

	test("never splits a surrogate pair", () => {
		expect(sliceChars("👍🏽", 0, 1)).toBe("👍");
		expect(sliceChars("👍🏽", 1)).toBe("🏽");
	});
});

describe("truncateChars", () => {
	test("returns short text unchanged", () => {
		expect(truncateChars("hello", 10)).toBe("hello");
	});

	test("appends the marker and stays within the budget", () => {
		const result = truncateChars("abcdefghij", 5);
		expect(result).toBe("abcd…");
		expect(charLength(result)).toBe(5);
	});

	test("keeps CJK well-formed", () => {
		const result = truncateChars("广州早茶文化", 4);
		expect(result).toBe("广州早…");
		expect(charLength(result)).toBe(4);
	});

	test("returns just the marker when there is no room", () => {
		expect(truncateChars("abcdef", 1)).toBe("…");
		expect(truncateChars("abcdef", 0)).toBe("…");
	});
});

describe("oneLine", () => {
	test("collapses control characters and whitespace to one line", () => {
		const out = oneLine("line1\u001b[31m\nline2\t\tend\u0007");
		expect(out).toBe("line1 [31m line2 end");
		expect(out).not.toContain("\u001b");
		expect(out).not.toContain("\u0007");
	});

	test("clips to a display width with an ellipsis", () => {
		const out = oneLine("x".repeat(200), 20);
		expect(visibleWidth(out)).toBeLessThanOrEqual(20);
		expect(out.endsWith("…")).toBe(true);
	});

	test("leaves clean text alone", () => {
		expect(oneLine("Pi — a coding agent")).toBe("Pi — a coding agent");
	});
});

describe("normalizeSearchConfig", () => {
	test("returns the base config for missing input", () => {
		expect(normalizeSearchConfig(undefined)).toEqual(DEFAULT_SEARCH_CONFIG);
	});

	test("clamps numeric values into range", () => {
		const config = normalizeSearchConfig({
			maxResults: 999,
			timeoutMs: 5,
			maxBytes: 1,
			minIntervalMs: -10,
			maxOutputChars: 10,
			safeSearch: 9,
		});
		expect(config.maxResults).toBe(MAX_RESULTS);
		expect(config.timeoutMs).toBe(1_000);
		expect(config.maxBytes).toBe(1_024);
		expect(config.minIntervalMs).toBe(0);
		expect(config.maxOutputChars).toBe(1_000);
		expect(config.safeSearch).toBe(2);
	});

	test("accepts a language code and rejects nonsense", () => {
		expect(normalizeSearchConfig({ language: "zh-CN" }).language).toBe("zh-CN");
		expect(normalizeSearchConfig({ language: "auto" }).language).toBe("auto");
		expect(normalizeSearchConfig({ language: "not a lang!" }).language).toBe(DEFAULT_SEARCH_CONFIG.language);
	});

	test("keeps a valid endpoint and rejects non-http", () => {
		expect(normalizeSearchConfig({ endpoint: "https://searx.example/" }).endpoint).toBe("https://searx.example/");
		expect(normalizeSearchConfig({ endpoint: "file:///etc/passwd" }).endpoint).toBe("");
	});

	test("allows an explicit empty endpoint to clear an inherited one", () => {
		const base = { ...DEFAULT_SEARCH_CONFIG, endpoint: "https://searx.example" };
		expect(normalizeSearchConfig({ endpoint: "" }, base).endpoint).toBe("");
		expect(normalizeSearchConfig({}, base).endpoint).toBe("https://searx.example");
	});

	test("keeps a custom user agent and treats blank as the default", () => {
		expect(normalizeSearchConfig({ userAgent: " my-bot " }).userAgent).toBe("my-bot");
		expect(normalizeSearchConfig({ userAgent: "   " }).userAgent).toBe(DEFAULT_SEARCH_CONFIG.userAgent);
	});

	test("accepts a known provider id and rejects unknown ones to the base", () => {
		expect(normalizeSearchConfig({ provider: "searxng" }).provider).toBe("searxng");
		expect(normalizeSearchConfig({ provider: "brave" }).provider).toBe("brave");
		expect(normalizeSearchConfig({ provider: "auto" }).provider).toBe("auto");
		expect(normalizeSearchConfig({ provider: "nope" }).provider).toBe(DEFAULT_SEARCH_CONFIG.provider);
		const base = { ...DEFAULT_SEARCH_CONFIG, provider: "brave" as const };
		expect(normalizeSearchConfig({ provider: "nope" }, base).provider).toBe("brave");
	});
});

describe("resolveSearchApiKey", () => {
	test("prefers an environment variable over a literal key", () => {
		withEnv({ WEB_ACCESS_CONFIG_TEST_KEY: "from-env" }, () => {
			const config = { ...DEFAULT_SEARCH_CONFIG, apiKeyEnv: "WEB_ACCESS_CONFIG_TEST_KEY", apiKey: "literal" };
			expect(resolveSearchApiKey(config)).toBe("from-env");
		});
	});

	test("falls back to a literal key when the variable is unset", () => {
		withEnv({ WEB_ACCESS_CONFIG_TEST_KEY: undefined }, () => {
			expect(
				resolveSearchApiKey({
					...DEFAULT_SEARCH_CONFIG,
					apiKeyEnv: "WEB_ACCESS_CONFIG_TEST_KEY",
					apiKey: "literal",
				}),
			).toBe("literal");
		});
	});

	test("falls back to a literal key when the variable is blank", () => {
		withEnv({ WEB_ACCESS_CONFIG_TEST_KEY: "   " }, () => {
			expect(
				resolveSearchApiKey({
					...DEFAULT_SEARCH_CONFIG,
					apiKeyEnv: "WEB_ACCESS_CONFIG_TEST_KEY",
					apiKey: "literal",
				}),
			).toBe("literal");
		});
	});

	test("returns undefined when no key is configured", () => {
		withEnv({ WEB_ACCESS_CONFIG_TEST_KEY: undefined }, () => {
			expect(resolveSearchApiKey(DEFAULT_SEARCH_CONFIG)).toBeUndefined();
		});
	});
});

function searchConfig(over: Partial<typeof DEFAULT_SEARCH_CONFIG> = {}): typeof DEFAULT_SEARCH_CONFIG {
	return { ...DEFAULT_SEARCH_CONFIG, ...over };
}

describe("providerFacts", () => {
	test("reports the keyless default when nothing is configured", () => {
		expect(providerFacts(searchConfig())).toEqual({
			provider: "duckduckgo",
			reason: "default",
			configured: true,
			endpoint: null,
			apiKeyEnv: null,
			keyConfigured: false,
		});
	});

	test("reports an explicit SearXNG with its endpoint", () => {
		const facts = providerFacts(searchConfig({ provider: "searxng", endpoint: "http://localhost:8080" }));
		expect(facts).toMatchObject({
			provider: "searxng",
			reason: "explicit",
			configured: true,
			endpoint: "http://localhost:8080",
		});
	});

	test("reports an explicit provider that is not configured", () => {
		const facts = providerFacts(searchConfig({ provider: "searxng" }));
		expect(facts).toMatchObject({ provider: "searxng", reason: "explicit", configured: false, endpoint: null });
	});

	test("names the key variable without ever carrying the key", () => {
		const facts = providerFacts(searchConfig({ provider: "brave", apiKeyEnv: "BRAVE_SEARCH_API_KEY" }));
		expect(facts).toMatchObject({
			provider: "brave",
			configured: false,
			apiKeyEnv: "BRAVE_SEARCH_API_KEY",
			keyConfigured: false,
		});
		expect(JSON.stringify(facts)).not.toContain("secret");
	});

	test("marks a literal key as configured", () => {
		const facts = providerFacts(searchConfig({ provider: "brave", apiKey: "literal-secret" }));
		expect(facts).toMatchObject({ provider: "brave", configured: true, keyConfigured: true });
		expect(JSON.stringify(facts)).not.toContain("literal-secret");
	});

	test("auto picks a configured SearXNG over the keyless default", () => {
		const facts = providerFacts(normalizeSearchConfig({ endpoint: "http://searx.local:8888" }));
		expect(facts).toMatchObject({ provider: "searxng", reason: "configured", endpoint: "http://searx.local:8888" });
	});

	test("has no endpoint to probe for a provider without one", () => {
		expect(providerFacts(searchConfig({ provider: "brave", apiKey: "k" })).endpoint).toBeNull();
	});
});

function searchResponse(overrides: Partial<SearchResponse>): SearchResponse {
	return {
		query: "pi agent",
		provider: "searxng",
		answer: "",
		results: [],
		truncated: false,
		fetchedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("formatResults", () => {
	test("renders a direct answer and numbered results", () => {
		const { text, truncated } = formatResults(
			searchResponse({
				answer: "Pi is a minimal agent harness.",
				results: [
					{ title: "Pi", url: "https://pi.dev/", snippet: "A harness." },
					{ title: "GitHub", url: "https://github.com/earendil-works/pi", snippet: "" },
				],
			}),
			10_000,
		);
		expect(text).toContain('SearXNG results for "pi agent"');
		expect(text).toContain("Answer: Pi is a minimal agent harness.");
		expect(text).toContain("1. Pi");
		expect(text).toContain("https://pi.dev/");
		expect(text).toContain("A harness.");
		expect(text).toContain("2. GitHub");
		expect(truncated).toBe(false);
	});

	test("uses the provider label in the header", () => {
		expect(formatResults(searchResponse({ provider: "duckduckgo" }), 10_000).text).toContain(
			'DuckDuckGo results for "pi agent"',
		);
		expect(formatResults(searchResponse({ provider: "brave" }), 10_000).text).toContain('Brave results for "pi agent"');
	});

	test("explains an empty result and points at web_fetch", () => {
		const { text, truncated } = formatResults(searchResponse({ provider: "none" }), 10_000);
		expect(text).toContain("No web results");
		expect(text).toContain("web_fetch");
		expect(truncated).toBe(false);
	});

	test("drops whole blocks that do not fit and notes the count", () => {
		const { text, truncated } = formatResults(
			searchResponse({
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
			searchResponse({
				results: [{ title: "中文标题", url: "https://example.cn/", snippet: "一段很长的中文摘要".repeat(20) }],
			}),
			60,
		);
		expect(truncated).toBe(true);
		expect(Array.from(text).length).toBeLessThanOrEqual(60);
		expect(text.endsWith("…")).toBe(true);
	});
});

describe("provider registry", () => {
	test("implements one provider per declared id, in order", () => {
		expect(SEARCH_PROVIDERS.map((provider) => provider.id)).toEqual([...SEARCH_PROVIDER_IDS]);
	});

	test("the default provider is keyless", () => {
		expect(DEFAULT_PROVIDER_ID).toBe("duckduckgo");
		expect(getProvider(DEFAULT_PROVIDER_ID).isConfigured(DEFAULT_SEARCH_CONFIG)).toBe(true);
	});

	test("auto picks the first configured provider", () => {
		expect(resolveProvider({ ...DEFAULT_SEARCH_CONFIG, endpoint: "https://searx.test" }).id).toBe("searxng");
		expect(resolveProvider({ ...DEFAULT_SEARCH_CONFIG, apiKey: "k" }).id).toBe("brave");
	});

	test("auto falls back to the keyless default with no configuration", () => {
		expect(resolveProvider(DEFAULT_SEARCH_CONFIG).id).toBe("duckduckgo");
	});

	test("an explicit choice wins even when unconfigured", () => {
		expect(resolveProvider({ ...DEFAULT_SEARCH_CONFIG, provider: "searxng" }).id).toBe("searxng");
		expect(resolveProvider({ ...DEFAULT_SEARCH_CONFIG, provider: "brave" }).id).toBe("brave");
	});
});

describe("providerLabel", () => {
	test("uses the provider label, and a generic label for none", () => {
		expect(providerLabel("searxng")).toBe("SearXNG");
		expect(providerLabel("duckduckgo")).toBe("DuckDuckGo");
		expect(providerLabel("brave")).toBe("Brave");
		expect(providerLabel("none")).toBe("Web");
	});
});

describe("Brave provider", () => {
	test("sets the query and a count clamped to Brave's maximum", () => {
		expect(buildBraveUrl("pi agent", 5).searchParams.get("q")).toBe("pi agent");
		expect(buildBraveUrl("pi agent", 5).searchParams.get("count")).toBe("5");
		expect(buildBraveUrl("pi agent", 999).searchParams.get("count")).toBe("20");
		expect(buildBraveUrl("pi agent", 0).searchParams.get("count")).toBe("1");
	});

	test("maps web results and de-duplicates", () => {
		const parsed = parseBrave(
			{
				web: {
					results: [
						{ title: "A", url: "https://a.example/", description: "alpha" },
						{ title: "A again", url: "https://a.example/", description: "dup" },
						{ title: "B", url: "https://b.example/", description: "" },
					],
				},
			},
			10,
		);
		expect(parsed.answer).toBe("");
		expect(parsed.results).toEqual([
			{ title: "A", url: "https://a.example/", snippet: "alpha" },
			{ title: "B", url: "https://b.example/", snippet: "" },
		]);
	});

	test("caps at maxResults and tolerates a malformed shape", () => {
		const results = Array.from({ length: 10 }, (_, index) => ({ title: `T${index}`, url: `https://x/${index}` }));
		expect(parseBrave({ web: { results } }, 3).results).toHaveLength(3);
		expect(parseBrave(undefined, 3)).toEqual({ answer: "", results: [] });
	});

	test("sends the subscription token and returns results", async () => {
		let token: string | undefined;
		const runner: HttpRunner = (request) => {
			token = request.headers?.["X-Subscription-Token"];
			return Promise.resolve(jsonResponse({ web: { results: [{ title: "Pi", url: "https://pi.dev/" }] } }));
		};
		const result = await searchBrave({ query: "q", maxResults: 5 }, DEFAULT_SEARCH_CONFIG, runner, undefined, "secret");
		expect(token).toBe("secret");
		expect(result.results).toHaveLength(1);
	});

	test("refuses to run without a key", async () => {
		const runner: HttpRunner = () => {
			throw new Error("the runner must not be called");
		};
		await expect(searchBrave({ query: "q", maxResults: 5 }, DEFAULT_SEARCH_CONFIG, runner, undefined)).rejects.toThrow(
			"API key",
		);
	});
});

describe("DuckDuckGo provider", () => {
	test("sets the query and the JSON/plain-text flags", () => {
		const url = buildDuckDuckGoUrl("pi agent");
		expect(url.host).toBe("api.duckduckgo.com");
		expect(url.searchParams.get("q")).toBe("pi agent");
		expect(url.searchParams.get("format")).toBe("json");
		expect(url.searchParams.get("no_html")).toBe("1");
		expect(url.searchParams.get("skip_disambig")).toBe("1");
	});

	test("strips tags, decodes entities, and collapses whitespace", () => {
		expect(sanitizeText("<b>Pi</b>&nbsp; is &amp; <i>a</i>\n harness")).toBe("Pi is & a harness");
	});

	test("leaves quotes and apostrophes intact", () => {
		expect(sanitizeText("&quot;Pi&#39;s&quot;")).toBe('"Pi\'s"');
	});

	test("uses the anchor text as the title and the rest as the snippet", () => {
		expect(splitTitleAndSnippet('<a href="https://x/">Pi</a>A harness.')).toEqual({
			title: "Pi",
			snippet: "A harness.",
		});
	});

	test("falls back to the whole text when there is no anchor", () => {
		expect(splitTitleAndSnippet("Plain text")).toEqual({ title: "Plain text", snippet: "" });
	});

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

	test("parses a JSON response", async () => {
		const runner: HttpRunner = () =>
			Promise.resolve(jsonResponse({ Answer: "42", RelatedTopics: [{ FirstURL: "https://x/", Text: "X" }] }));
		const result = await searchDuckDuckGo({ query: "q", maxResults: 5 }, DEFAULT_SEARCH_CONFIG, runner, undefined);
		expect(result.answer).toBe("42");
		expect(result.results).toHaveLength(1);
	});

	test("throws on a non-2xx response", async () => {
		const runner: HttpRunner = () => Promise.resolve(jsonResponse("nope", 503));
		await expect(
			searchDuckDuckGo({ query: "q", maxResults: 5 }, DEFAULT_SEARCH_CONFIG, runner, undefined),
		).rejects.toThrow(HttpUnavailableError);
	});

	test("throws on invalid JSON", async () => {
		const runner: HttpRunner = () =>
			Promise.resolve({ status: 200, body: "<html>", contentType: "text/html", finalUrl: "", sizeBytes: 6 });
		await expect(
			searchDuckDuckGo({ query: "q", maxResults: 5 }, DEFAULT_SEARCH_CONFIG, runner, undefined),
		).rejects.toThrow("invalid JSON");
	});
});

describe("SearXNG provider", () => {
	test("auto picks en for Latin text", () => {
		expect(searxngLanguageFor("pi agent", "auto")).toBe("en");
	});

	test("auto picks zh-CN for Han text", () => {
		expect(searxngLanguageFor("广州 早茶", "auto")).toBe("zh-CN");
	});

	test("an explicit code passes through", () => {
		expect(searxngLanguageFor("广州 早茶", "de")).toBe("de");
	});

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
		const results = Array.from({ length: 10 }, (_, index) => ({
			title: `T${index}`,
			url: `https://x/${index}`,
			content: "",
		}));
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

const REQUEST: SearchRequest = { query: "pi agent", maxResults: 5 };
const searxngConfig = { ...DEFAULT_SEARCH_CONFIG, provider: "searxng" as const, endpoint: "https://searx.test" };
const keylessConfig = { ...DEFAULT_SEARCH_CONFIG, minIntervalMs: 0 };
const braveConfig = { ...DEFAULT_SEARCH_CONFIG, provider: "brave" as const, minIntervalMs: 0, apiKey: "k" };

const noThrottle: Throttle = { wait: () => Promise.resolve() };

function searxngRunner(body: unknown, status = 200): HttpRunner {
	return () => Promise.resolve(jsonResponse(body, status));
}

describe("runSearch", () => {
	test("resolves SearXNG from an endpoint and returns its results and answer", async () => {
		const runner = searxngRunner({
			answers: ["Pi is a harness."],
			results: [{ title: "Pi", url: "https://pi.dev/", content: "A harness." }],
		});
		const outcome = await runSearch(REQUEST, searxngConfig, undefined, { http: runner, throttle: noThrottle });
		expect(outcome.provider).toBe("searxng");
		expect(outcome.answer).toBe("Pi is a harness.");
		expect(outcome.results).toEqual([{ title: "Pi", url: "https://pi.dev/", snippet: "A harness." }]);
	});

	test("uses the keyless DuckDuckGo provider when nothing is configured", async () => {
		const runner = searxngRunner({
			AbstractText: "Pi is a harness.",
			RelatedTopics: [{ FirstURL: "https://pi.dev/", Text: '<a href="https://pi.dev/">Pi</a>A harness.' }],
		});
		const outcome = await runSearch(REQUEST, keylessConfig, undefined, { http: runner, throttle: noThrottle });
		expect(outcome.provider).toBe("duckduckgo");
		expect(outcome.answer).toBe("Pi is a harness.");
		expect(outcome.results).toEqual([{ title: "Pi", url: "https://pi.dev/", snippet: "A harness." }]);
	});

	test("resolves Brave when a key is present under auto", async () => {
		const runner = searxngRunner({ web: { results: [{ title: "Pi", url: "https://pi.dev/", description: "x" }] } });
		const outcome = await runSearch(REQUEST, { ...DEFAULT_SEARCH_CONFIG, minIntervalMs: 0, apiKey: "k" }, undefined, {
			http: runner,
			throttle: noThrottle,
		});
		expect(outcome.provider).toBe("brave");
		expect(outcome.results).toHaveLength(1);
	});

	test("returns none when the provider has no results", async () => {
		const outcome = await runSearch(REQUEST, searxngConfig, undefined, {
			http: searxngRunner({}),
			throttle: noThrottle,
		});
		expect(outcome).toEqual({ provider: "none", answer: "", results: [] });
	});

	test("caps results at maxResults", async () => {
		const results = Array.from({ length: 10 }, (_, index) => ({
			title: `T${index}`,
			url: `https://x/${index}`,
			content: "",
		}));
		const outcome = await runSearch({ ...REQUEST, maxResults: 3 }, searxngConfig, undefined, {
			http: searxngRunner({ results }),
			throttle: noThrottle,
		});
		expect(outcome.results).toHaveLength(3);
	});

	test("explains a forced provider that is not configured, before any request", async () => {
		const runner: HttpRunner = () => {
			throw new Error("the runner must not be called");
		};
		await expect(
			runSearch(REQUEST, { ...searxngConfig, endpoint: "" }, undefined, { http: runner, throttle: noThrottle }),
		).rejects.toThrow("search.endpoint");
		await expect(
			runSearch(REQUEST, { ...braveConfig, apiKey: "" }, undefined, { http: runner, throttle: noThrottle }),
		).rejects.toThrow("apiKeyEnv");
	});

	test("surfaces a non-2xx response as a search failure", async () => {
		await expect(
			runSearch(REQUEST, searxngConfig, undefined, { http: searxngRunner("boom", 500), throttle: noThrottle }),
		).rejects.toThrow(WebSearchError);
	});

	test("surfaces invalid JSON with a format=json hint", async () => {
		const runner: HttpRunner = () =>
			Promise.resolve({
				status: 200,
				body: "<html>",
				contentType: "text/html",
				finalUrl: "https://searx.test/",
				sizeBytes: 6,
			});
		await expect(runSearch(REQUEST, searxngConfig, undefined, { http: runner, throttle: noThrottle })).rejects.toThrow(
			"format=json",
		);
	});

	test("waits on the injected throttle with the configured interval", async () => {
		const waited: number[] = [];
		const throttle: Throttle = {
			wait: (ms) => {
				waited.push(ms);
				return Promise.resolve();
			},
		};
		await runSearch(REQUEST, { ...searxngConfig, minIntervalMs: 250 }, undefined, {
			http: searxngRunner({}),
			throttle,
		});
		expect(waited).toEqual([250]);
	});

	test("sends a bearer token resolved from the environment to SearXNG", async () => {
		await withEnv({ WEB_ACCESS_TEST_KEY: "secret" }, async () => {
			let authorization: string | undefined;
			const runner: HttpRunner = (request) => {
				authorization = request.headers?.Authorization;
				return Promise.resolve(jsonResponse({ results: [{ title: "Pi", url: "https://pi.dev/" }] }));
			};
			await runSearch(REQUEST, { ...searxngConfig, apiKeyEnv: "WEB_ACCESS_TEST_KEY", minIntervalMs: 0 }, undefined, {
				http: runner,
				throttle: noThrottle,
			});
			expect(authorization).toBe("Bearer secret");
		});
	});

	test("propagates caller cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		const runner: HttpRunner = () => Promise.reject(new HttpUnavailableError("Request failed: aborted"));
		await expect(
			runSearch(REQUEST, searxngConfig, controller.signal, { http: runner, throttle: noThrottle }),
		).rejects.toThrow(WebSearchError);
	});
});

describe("createThrottle", () => {
	test("does not sleep when the interval is zero", async () => {
		const slept: number[] = [];
		const throttle = createThrottle(makeClock().now, (ms) => {
			slept.push(ms);
			return Promise.resolve();
		});
		await throttle.wait(0, undefined);
		await throttle.wait(0, undefined);
		expect(slept).toEqual([]);
	});

	test("sleeps only for the remaining gap between requests", async () => {
		const clock = makeClock();
		const slept: number[] = [];
		const throttle = createThrottle(clock.now, (ms) => {
			slept.push(ms);
			return Promise.resolve();
		});
		await throttle.wait(40, undefined);
		clock.advance(10);
		await throttle.wait(40, undefined);
		expect(slept).toEqual([30]);
	});
});

describe("web_search tool", () => {
	const agentDir = tempDir("web-access-search-agent-");
	useEnv({ PI_CODING_AGENT_DIR: agentDir });

	const configCwd = tempDir("web-access-search-cwd-");
	mkdirSync(join(configCwd, ".pi"), { recursive: true });
	writeFileSync(
		join(configCwd, ".pi", "bytefly.json"),
		JSON.stringify({
			"web-access": { search: { provider: "searxng", endpoint: "https://searx.test", minIntervalMs: 0 } },
		}),
	);
	const emptyCwd = tempDir("web-access-search-empty-cwd-");
	const forcedCwd = tempDir("web-access-search-forced-cwd-");
	mkdirSync(join(forcedCwd, ".pi"), { recursive: true });
	writeFileSync(
		join(forcedCwd, ".pi", "bytefly.json"),
		JSON.stringify({ "web-access": { search: { provider: "searxng", minIntervalMs: 0 } } }),
	);

	const ctx = { cwd: configCwd, mode: "tui", hasUI: true };
	const emptyCtx = { cwd: emptyCwd, mode: "tui", hasUI: true };
	const forcedCtx = { cwd: forcedCwd, mode: "tui", hasUI: true };

	const mustNotRun: HttpRunner = () => {
		throw new Error("the runner must not be called");
	};

	interface SearchTool {
		execute: (
			id: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
			onUpdate?: unknown,
			context?: unknown,
		) => Promise<{
			content: Array<{ type: string; text: string }>;
			details: SearchResponse;
			structuredContent: SearchResponse;
		}>;
		renderCall: (args: unknown, theme: unknown, context: unknown) => { render: (width: number) => string[] };
		renderResult: (
			result: unknown,
			options: { expanded: boolean; isPartial?: boolean },
			theme: unknown,
			context: unknown,
		) => { render: (width: number) => string[] };
	}

	function installTool(runner: HttpRunner) {
		const { pi, tools } = createFakePi();
		registerSearchTool(pi, { http: runner, throttle: noThrottle });
		return tools.get(TOOL_NAME) as SearchTool;
	}

	function renderer() {
		const { pi, tools } = createFakePi();
		registerSearchTool(pi, { http: mustNotRun, throttle: noThrottle });
		return tools.get(TOOL_NAME) as SearchTool;
	}

	const renderText = (component: { render: (width: number) => string[] }): string => component.render(80).join("\n");

	test("registers web_search as a direct, active, sequential, read-only tool", () => {
		const { pi, tools } = createFakePi();
		registerSearchTool(pi);
		const tool = tools.get(TOOL_NAME);
		expect(tool).toBeDefined();
		expect(tool.exposure).toBeUndefined();
		expect(tool.defaultActive).toBeUndefined();
		expect(tool.executionMode).toBe("sequential");
		expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
		expect(tool.outputSchema).toBeDefined();
	});

	test("execute returns model text, details, and matching structuredContent", async () => {
		const tool = installTool(() =>
			Promise.resolve(jsonResponse({ results: [{ title: "Pi", url: "https://pi.dev/", content: "A harness." }] })),
		);

		const result = await tool.execute("call-1", { query: "pi agent" }, undefined, undefined, ctx);

		expect(result.content[0].text).toContain("SearXNG results");
		expect(result.content[0].text).toContain("https://pi.dev/");
		expect(result.details.provider).toBe("searxng");
		expect(result.structuredContent).toEqual(result.details);
	});

	test("works with no configuration via the keyless default", async () => {
		const tool = installTool(() =>
			Promise.resolve(jsonResponse({ Answer: "42", RelatedTopics: [{ FirstURL: "https://x/", Text: "X" }] })),
		);

		const result = await tool.execute("call-2", { query: "answer" }, undefined, undefined, emptyCtx);

		expect(result.content[0].text).toContain("DuckDuckGo results");
		expect(result.details.provider).toBe("duckduckgo");
	});

	test("execute surfaces a total failure as a thrown error", async () => {
		const tool = installTool(() => Promise.resolve(jsonResponse("boom", 500)));

		await expect(tool.execute("call-3", { query: "x" }, undefined, undefined, ctx)).rejects.toThrow("Search failed");
	});

	test("execute explains a missing endpoint for a forced SearXNG provider", async () => {
		const tool = installTool(mustNotRun);
		await expect(tool.execute("call-4", { query: "x" }, undefined, undefined, forcedCtx)).rejects.toThrow(
			"search.endpoint",
		);
	});

	test("rejects an empty query before any request", async () => {
		const tool = installTool(mustNotRun);

		await expect(tool.execute("call-5", { query: "   " }, undefined, undefined, ctx)).rejects.toThrow(
			"query is required",
		);
	});

	test("the call states the request limit and the result the actual count", () => {
		const tool = renderer();
		const call = renderText(
			tool.renderCall({ query: "retry", maxResults: 3 }, fakeTheme, { lastComponent: undefined }),
		);
		expect(call).toContain("(max 3)");

		const details = searchResponse({
			provider: "duckduckgo",
			results: [
				{ title: "A", url: "https://a/", snippet: "" },
				{ title: "B", url: "https://b/", snippet: "" },
			],
		});
		const result = renderText(
			tool.renderResult({ details, content: [{ type: "text", text: "" }] }, { expanded: false }, fakeTheme, {
				lastComponent: undefined,
			}),
		);
		expect(result).toContain("2 results");
	});

	test("collapsed hints at the remaining results and expanded shows them", () => {
		const tool = renderer();
		const results = Array.from({ length: 8 }, (_, index) => ({
			title: `T${index}`,
			url: `https://x/${index}`,
			snippet: `S${index}`,
		}));
		const details = searchResponse({ provider: "searxng", results });
		const withOptions = (expanded: boolean) =>
			renderText(
				tool.renderResult({ details, content: [{ type: "text", text: "" }] }, { expanded }, fakeTheme, {
					lastComponent: undefined,
				}),
			);

		const collapsed = withOptions(false);
		expect(collapsed).toContain("https://x/0");
		expect(collapsed).toContain("+3 more");
		expect(collapsed).toContain("to expand");
		expect(collapsed).not.toContain("T7");
		expect(collapsed).not.toContain("S0");

		const expanded = withOptions(true);
		expect(expanded).toContain("T7");
		expect(expanded).toContain("https://x/7");
		expect(expanded).toContain("S7");
		expect(expanded).not.toContain("more");
	});

	test("renders a no-results line for an empty provider", () => {
		const tool = renderer();
		const text = renderText(
			tool.renderResult(
				{
					details: searchResponse({ query: "z\u0007", provider: "none", results: [] }),
					content: [{ type: "text", text: "" }],
				},
				{ expanded: false },
				fakeTheme,
				{ lastComponent: undefined },
			),
		);
		expect(text).toContain("No results for");
		expect(text).not.toContain("\u0007");
	});
});

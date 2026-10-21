/**
 * The `web_fetch` capability: page cache, fetch config, readable extraction,
 * find-in-page, output formatting, the fetching runtime, request validation, the
 * SSRF guard, and the tool surface.
 *
 * The HTTP runner, DNS lookup, PDF extractor, and clock are injected, so the
 * suite never reaches the network or the wall clock.
 */

import { beforeEach, describe, expect, it, test } from "bun:test";
import { decodeEntities } from "../html.ts";
import type { HttpResponse, HttpRunner } from "../http.ts";
import { tempDir, useEnv } from "../../../test/helpers/env.ts";
import { createFakePi, emit, fakeTheme } from "../../../test/helpers/fakes.ts";
import { htmlResponse } from "../../../test/helpers/fixtures/web-access.ts";
import type { PdfExtractor } from "../../../lib/pdf.ts";
import { createPageCache, type CachedPage } from "./cache.ts";
import { DEFAULT_FETCH_CONFIG, normalizeFetchConfig } from "./config.ts";
import { extractReadable, extractTitle } from "./extract.ts";
import { findPassages, toCodePointOffset, type FindOptions } from "./find.ts";
import { formatMatches, formatPage } from "./format.ts";
import { runFetch } from "./page.ts";
import { resolveRequest, type FetchResponse, type WebFetchArgs } from "./schema.ts";
import { assertAllowedUrl, isBlockedHostname, isBlockedIp, SsrfError, type LookupImpl } from "./ssrf.ts";
import { registerFetchTool, TOOL_NAME } from "./tool.ts";
import type { FetchRequest } from "./types.ts";

function cachePage(url: string, text = "hello", storedAt = 1000): CachedPage {
	return {
		url,
		finalUrl: url,
		title: "T",
		status: 200,
		contentType: "text/html",
		text,
		fetchedAt: "2026-01-01T00:00:00.000Z",
		storedAt,
		bytes: new TextEncoder().encode(text).length,
	};
}

const CACHE_LIMITS = { maxEntries: 8, maxBytes: 1_000_000 };

/** A cache with a controllable clock, so TTL tests do not touch wall time. */
function clockedCache(now = 1000) {
	let current = now;
	const cache = createPageCache(() => current);
	return { cache, at: (value: number) => (current = value) };
}

describe("page cache", () => {
	test("stores and retrieves a page", () => {
		const { cache } = clockedCache();
		cache.set("https://a/", cachePage("https://a/", "body"), CACHE_LIMITS);
		expect(cache.get("https://a/", 1000)?.text).toBe("body");
		expect(cache.get("https://missing/", 1000)).toBeUndefined();
	});

	test("expires entries past the TTL", () => {
		const { cache, at } = clockedCache();
		cache.set("https://a/", cachePage("https://a/", "body", 1000), CACHE_LIMITS);
		at(1050);
		expect(cache.get("https://a/", 100)).toBeDefined();
		at(1200);
		expect(cache.get("https://a/", 100)).toBeUndefined();
	});

	test("treats ttl 0 as never expiring", () => {
		const { cache, at } = clockedCache();
		cache.set("https://a/", cachePage("https://a/", "body", 1000), CACHE_LIMITS);
		at(99_999_999);
		expect(cache.get("https://a/", 0)).toBeDefined();
	});

	test("evicts the least recently used entry by count", () => {
		const { cache } = clockedCache();
		const small = { maxEntries: 2, maxBytes: 1_000_000 };
		cache.set("https://a/", cachePage("https://a/"), small);
		cache.set("https://b/", cachePage("https://b/"), small);
		cache.set("https://c/", cachePage("https://c/"), small);
		expect(cache.get("https://a/", 0)).toBeUndefined();
		expect(cache.get("https://b/", 0)).toBeDefined();
		expect(cache.size()).toBe(2);
	});

	test("keeps recently used entries when evicting", () => {
		const { cache } = clockedCache();
		const small = { maxEntries: 2, maxBytes: 1_000_000 };
		cache.set("https://a/", cachePage("https://a/"), small);
		cache.set("https://b/", cachePage("https://b/"), small);
		cache.get("https://a/", 0);
		cache.set("https://c/", cachePage("https://c/"), small);
		expect(cache.get("https://b/", 0)).toBeUndefined();
		expect(cache.get("https://a/", 0)).toBeDefined();
	});

	test("evicts by total bytes", () => {
		const { cache } = clockedCache();
		const tiny = { maxEntries: 8, maxBytes: 10 };
		cache.set("https://a/", cachePage("https://a/", "12345678"), tiny);
		cache.set("https://b/", cachePage("https://b/", "87654321"), tiny);
		expect(cache.get("https://a/", 0)).toBeUndefined();
		expect(cache.get("https://b/", 0)).toBeDefined();
	});

	test("clears everything", () => {
		const { cache } = clockedCache();
		cache.set("https://a/", cachePage("https://a/"), CACHE_LIMITS);
		cache.clear();
		expect(cache.size()).toBe(0);
		expect(cache.get("https://a/", 0)).toBeUndefined();
	});

	test("instances are independent", () => {
		const first = createPageCache();
		const second = createPageCache();
		first.set("https://a/", cachePage("https://a/"), CACHE_LIMITS);
		expect(second.get("https://a/", 0)).toBeUndefined();
	});
});

describe("normalizeFetchConfig", () => {
	test("returns the base config for missing input", () => {
		expect(normalizeFetchConfig(undefined)).toEqual(DEFAULT_FETCH_CONFIG);
	});

	test("clamps numeric values into range", () => {
		const config = normalizeFetchConfig({ timeoutMs: 5, maxBytes: 1, maxOutputChars: 10 });
		expect(config.timeoutMs).toBe(1_000);
		expect(config.maxBytes).toBe(1_024);
		expect(config.maxOutputChars).toBe(500);
	});

	test("only a boolean enables allowPrivateHosts", () => {
		expect(normalizeFetchConfig({ allowPrivateHosts: true }).allowPrivateHosts).toBe(true);
		expect(normalizeFetchConfig({ allowPrivateHosts: "yes" as unknown as boolean }).allowPrivateHosts).toBe(false);
	});

	test("clamps cache settings and defaults cacheEnabled", () => {
		const config = normalizeFetchConfig({
			cacheTtlMs: -5,
			cacheMaxEntries: 0,
			cacheMaxBytes: 1,
			cacheEnabled: "x" as unknown as boolean,
		});
		expect(config.cacheTtlMs).toBe(0);
		expect(config.cacheMaxEntries).toBe(1);
		expect(config.cacheMaxBytes).toBe(1_024);
		expect(config.cacheEnabled).toBe(DEFAULT_FETCH_CONFIG.cacheEnabled);
	});

	test("clamps the redirect and body limits", () => {
		const config = normalizeFetchConfig({ maxRedirects: 99, maxBodyChars: 1 });
		expect(config.maxRedirects).toBe(10);
		expect(config.maxBodyChars).toBe(1_000);
	});

	test("validates the PDF setting", () => {
		const config = normalizeFetchConfig({ pdfEnabled: "yes" as unknown as boolean });
		expect(config.pdfEnabled).toBe(true);
		expect(normalizeFetchConfig({ pdfEnabled: false }).pdfEnabled).toBe(false);
	});

	test("keeps a custom user agent and treats blank as the default", () => {
		expect(normalizeFetchConfig({ userAgent: " my-bot " }).userAgent).toBe("my-bot");
		expect(normalizeFetchConfig({ userAgent: "   " }).userAgent).toBe(DEFAULT_FETCH_CONFIG.userAgent);
	});
});

const FIXTURE = `<!doctype html>
<html>
<head><title>Pi &amp; Co &#x27;quoted&#x27;</title><style>.a{color:red}</style></head>
<body>
  <nav>Nav junk <a href="/nav">Nav</a></nav>
  <script>var x = "<p>not text</p>";</script>
  <header>Header junk</header>
  <article>
    <h1>Heading</h1>
    <p>First paragraph with <b>bold</b> and a <a href="/relative">relative link</a>.</p>
    <ul><li>One</li><li>Two</li></ul>
    <p>Second <a href="https://ext.example/x">external</a> and <a href="javascript:void(0)">bad link</a>.</p>
    <img alt="A picture">
  </article>
  <footer>Footer junk</footer>
</body>
</html>`;

describe("decodeEntities", () => {
	test("decodes named and numeric entities", () => {
		expect(decodeEntities("A &amp; B &#39;c&#39; &#x2764;")).toBe("A & B 'c' ❤");
	});
});

describe("extractTitle", () => {
	test("reads and decodes the title tag", () => {
		expect(extractTitle(FIXTURE)).toBe("Pi & Co 'quoted'");
	});

	test("prefers og:title", () => {
		expect(extractTitle('<title>Plain</title><meta property="og:title" content="OG &amp; Title">')).toBe("OG & Title");
	});
});

describe("extractReadable", () => {
	const page = extractReadable(FIXTURE, "https://base.example/dir/page");

	test("keeps headings, paragraphs, and list items", () => {
		expect(page.text).toContain("# Heading");
		expect(page.text).toContain("First paragraph with bold");
		expect(page.text).toContain("- One");
		expect(page.text).toContain("- Two");
	});

	test("resolves relative links and drops unusable ones", () => {
		expect(page.text).toContain("[relative link](https://base.example/relative)");
		expect(page.text).toContain("[external](https://ext.example/x)");
		expect(page.text).toContain("bad link");
		expect(page.text).not.toContain("javascript:");
	});

	test("turns images into alt text", () => {
		expect(page.text).toContain("[A picture]");
	});

	test("removes scripts, styles, nav, header, and footer", () => {
		expect(page.text).not.toContain("color:red");
		expect(page.text).not.toContain("not text");
		expect(page.text).not.toContain("Nav junk");
		expect(page.text).not.toContain("Header junk");
		expect(page.text).not.toContain("Footer junk");
	});

	test("prefers the largest main/article over surrounding chrome", () => {
		const html = `<body><main><p>small</p></main><article><p>${"big ".repeat(50)}</p></article></body>`;
		expect(extractReadable(html, "https://x/").text).toContain("big big");
	});

	test("falls back to the body when the largest article is only a fragment", () => {
		const filler = `<p>${"real content ".repeat(40)}</p>`;
		const html = `<body><article><p>teaser</p></article>${filler}</body>`;
		const text = extractReadable(html, "https://x/").text;
		expect(text).toContain("real content");
		expect(text).toContain("teaser");
	});

	test("preserves CJK text", () => {
		const cjk = extractReadable("<body><p>广州 早茶 文化</p></body>", "https://x/").text;
		expect(cjk).toContain("广州 早茶 文化");
	});
});

const FIND_OPTIONS = (overrides: Partial<FindOptions> = {}): FindOptions => ({
	mode: "insensitive",
	contextChars: 200,
	maxMatches: 8,
	...overrides,
});

describe("toCodePointOffset", () => {
	test("counts astral characters once", () => {
		expect(toCodePointOffset("a😀b", 0)).toBe(0);
		expect(toCodePointOffset("a😀b", 3)).toBe(2);
	});
});

describe("findPassages", () => {
	test("exact mode is case-sensitive", () => {
		expect(findPassages("Alpha alpha", ["Alpha"], FIND_OPTIONS({ mode: "exact" }))).toHaveLength(1);
		expect(findPassages("Alpha alpha", ["alpha"], FIND_OPTIONS({ mode: "exact" }))).toHaveLength(1);
	});

	test("insensitive mode matches any case", () => {
		const matches = findPassages("Alpha alpha", ["ALPHA"], FIND_OPTIONS());
		expect(matches.map((match) => match.offset)).toEqual([0, 6]);
	});

	test("reports CJK offsets in code points", () => {
		const matches = findPassages("你好广州早茶文化", ["早茶"], FIND_OPTIONS());
		expect(matches).toHaveLength(1);
		expect(matches[0].offset).toBe(4);
	});

	test("clips context with ellipses", () => {
		const [match] = findPassages("xxxMATCHyyy", ["MATCH"], FIND_OPTIONS({ contextChars: 2 }));
		expect(match.passage).toBe("…xxMATCHyy…");
	});

	test("respects maxMatches", () => {
		expect(findPassages("a a a a a", ["a"], FIND_OPTIONS({ contextChars: 0, maxMatches: 2 }))).toHaveLength(2);
	});

	test("handles multiple queries", () => {
		const matches = findPassages("one two three", ["one", "three"], FIND_OPTIONS({ contextChars: 0 }));
		expect(matches.map((match) => match.query)).toEqual(["one", "three"]);
	});

	test("fuzzy mode ranks lines by term coverage", () => {
		const text = "the quick brown fox\nlazy dog sleeps\nbrown fox jumps";
		const matches = findPassages(text, ["brown fox"], FIND_OPTIONS({ mode: "fuzzy" }));
		expect(matches).toHaveLength(2);
		expect(matches[0].offset).toBe(0);
		expect(matches[0].passage).toContain("brown fox");
	});

	test("fuzzy mode splits spaceless CJK queries into characters", () => {
		const matches = findPassages("广州早茶文化", ["早茶"], FIND_OPTIONS({ mode: "fuzzy" }));
		expect(matches.length).toBeGreaterThan(0);
	});

	test("returns nothing when the query is absent", () => {
		expect(findPassages("hello world", ["missing"], FIND_OPTIONS())).toEqual([]);
	});
});

function pageInput(overrides: Partial<Parameters<typeof formatPage>[0]> = {}) {
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

function matchInput(overrides: Partial<Parameters<typeof formatMatches>[0]> = {}) {
	const passage = (offset: number) => ({
		query: "hit",
		offset,
		passage: `${"x".repeat(190)}hit${offset}${"y".repeat(190)}`,
	});
	return {
		finalUrl: "https://example.com/",
		title: "Example",
		status: 200,
		contentType: "text/html",
		matches: [0, 1, 2].map((index) => passage(index * 100)),
		find: ["hit"],
		maxChars: 20_000,
		cappedByMaxMatches: false,
		...overrides,
	};
}

describe("formatMatches", () => {
	test("renders every passage when they fit", () => {
		const result = formatMatches(matchInput());
		expect(result.included).toHaveLength(3);
		expect(result.truncated).toBe(false);
		expect(result.text).toContain("1. [offset 0]");
		expect(result.body.split("\n\n")).toHaveLength(3);
	});

	test("stops at the character budget and names it", () => {
		const result = formatMatches(matchInput({ maxChars: 1200 }));
		expect(result.included.length).toBeLessThan(3);
		expect(result.truncated).toBe(true);
		expect(Array.from(result.text).length).toBeLessThanOrEqual(1200);
		expect(result.text).toContain(`showing ${result.included.length} of 3 matches within 1200 characters`);
		expect(result.text).toContain("lower contextChars");
	});

	test("names the match cap when the budget is not what limited it", () => {
		const result = formatMatches(matchInput({ matches: matchInput().matches.slice(0, 2), cappedByMaxMatches: true }));
		expect(result.truncated).toBe(true);
		expect(result.text).toContain("raise maxMatches");
	});

	test("still returns a passage when a single one is larger than the budget", () => {
		const result = formatMatches(matchInput({ maxChars: 400 }));
		expect(result.included).toHaveLength(1);
		expect(Array.from(result.text).length).toBeLessThanOrEqual(400);
		expect(result.text).toContain("[offset 0]");
	});

	test("reports no matches", () => {
		const result = formatMatches(matchInput({ matches: [] }));
		expect(result.text).toContain("No matches.");
		expect(result.truncated).toBe(false);
	});
});

describe("formatPage", () => {
	test("renders a header and the body", () => {
		const result = formatPage(pageInput());
		expect(result.text).toContain("Title: Example");
		expect(result.text).toContain("URL: https://example.com/");
		expect(result.text).toContain("Status: 200 (text/html)");
		expect(result.body).toBe("hello world");
		expect(result.truncated).toBe(false);
		expect(result.nextIndex).toBe(0);
	});

	test("slices and reports the next index when truncated", () => {
		const result = formatPage(pageInput({ text: "0123456789", startIndex: 0, maxChars: 200 }));
		expect(result.body).toBe("0123456789");
		expect(result.truncated).toBe(false);

		const paged = formatPage(pageInput({ text: "0123456789".repeat(100), startIndex: 0, maxChars: 200 }));
		expect(paged.truncated).toBe(true);
		expect(paged.text).toContain(`startIndex=${paged.nextIndex}`);
	});

	test("keeps the truncation hint inside the budget", () => {
		const result = formatPage(pageInput({ text: "x".repeat(10_000), startIndex: 0, maxChars: 500 }));
		expect(result.truncated).toBe(true);
		expect(Array.from(result.text).length).toBeLessThanOrEqual(500);
		expect(result.text).toContain(`call web_fetch again with startIndex=${result.nextIndex}`);
	});

	test("continues from startIndex", () => {
		const text = "0123456789".repeat(100);
		const first = formatPage(pageInput({ text, startIndex: 0, maxChars: 200 }));
		const second = formatPage(pageInput({ text, startIndex: first.nextIndex, maxChars: 200 }));
		expect(second.body).toBe(
			Array.from(text)
				.slice(first.nextIndex, first.nextIndex + second.body.length)
				.join(""),
		);
		expect(second.nextIndex).toBeGreaterThan(first.nextIndex);
	});

	test("is code-point safe for CJK", () => {
		const text = "广州早茶文化".repeat(200);
		const result = formatPage(pageInput({ text, startIndex: 0, maxChars: 200 }));
		expect(result.body).toBe(Array.from(text).slice(0, Array.from(result.body).length).join(""));
		expect(result.truncated).toBe(true);
	});

	test("reports when startIndex is past the end", () => {
		const result = formatPage(pageInput({ text: "abc", startIndex: 10 }));
		expect(result.body).toBe("");
		expect(result.text).toContain("no text at startIndex 10");
	});

	test("reports an empty page", () => {
		const result = formatPage(pageInput({ text: "" }));
		expect(result.text).toContain("(no readable text)");
	});

	test("omits the title line when there is no title", () => {
		const result = formatPage(pageInput({ title: "" }));
		expect(result.text).not.toContain("Title:");
	});
});

const CONFIG = { ...DEFAULT_FETCH_CONFIG, timeoutMs: 5000 };

function baseRequest(overrides: Partial<FetchRequest> = {}): FetchRequest {
	return {
		url: "https://1.1.1.1/start",
		method: "GET",
		headers: {},
		startIndex: 0,
		maxChars: 5000,
		find: [],
		mode: "insensitive",
		contextChars: 200,
		maxMatches: 8,
		refresh: false,
		cacheable: true,
		...overrides,
	};
}

function redirect(location: string, status = 302): HttpResponse {
	return {
		status,
		body: "",
		contentType: "text/html",
		finalUrl: "https://1.1.1.1/start",
		sizeBytes: 0,
		location,
	};
}

function html(body = "<article><p>next</p></article>"): HttpResponse {
	return { status: 200, body, contentType: "text/html", finalUrl: "https://1.1.1.1/next", sizeBytes: body.length };
}

function pdfResponse(): HttpResponse {
	const bytes = new Uint8Array([37, 80, 68, 70]);
	return {
		status: 200,
		body: "%PDF",
		contentType: "application/pdf",
		finalUrl: "https://1.1.1.1/file.pdf",
		sizeBytes: bytes.length,
		bytes,
	};
}

/** "中文页面" in GBK. */
const GBK_TEXT = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xd2, 0xb3, 0xc3, 0xe6]);

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		merged.set(part, offset);
		offset += part.length;
	}
	return merged;
}

function gbkPage(prefix: string): HttpResponse {
	const bytes = concatBytes(
		new TextEncoder().encode(`<html><head><title>${prefix}</title></head><body><article><p>`),
		GBK_TEXT,
		new TextEncoder().encode("</p></article></body></html>"),
	);
	return {
		status: 200,
		body: "",
		contentType: "text/html",
		finalUrl: "https://1.1.1.1/gbk",
		sizeBytes: bytes.length,
		bytes,
	};
}

describe("runFetch redirects", () => {
	test("follows a redirect to a public address", async () => {
		const seen: string[] = [];
		const runner: HttpRunner = (request) => {
			seen.push(request.url);
			return Promise.resolve(request.url.endsWith("/start") ? redirect("https://1.1.1.1/next") : html());
		};
		const page = await runFetch("https://1.1.1.1/start", baseRequest(), CONFIG, undefined, { http: runner });
		expect(seen).toEqual(["https://1.1.1.1/start", "https://1.1.1.1/next"]);
		expect(page.text).toContain("next");
	});

	test("refuses a redirect to a private address", async () => {
		const runner: HttpRunner = () => Promise.resolve(redirect("http://169.254.169.254/latest/meta-data"));
		await expect(runFetch("https://1.1.1.1/start", baseRequest(), CONFIG, undefined, { http: runner })).rejects.toThrow(
			/internal/,
		);
	});

	test("throws when there are too many redirects", async () => {
		const runner: HttpRunner = () => Promise.resolve(redirect("https://1.1.1.1/loop"));
		await expect(runFetch("https://1.1.1.1/start", baseRequest(), CONFIG, undefined, { http: runner })).rejects.toThrow(
			/Too many redirects/,
		);
	});

	test("rewrites a 303 POST to a bodyless GET", async () => {
		const calls: Array<{ method?: string; body?: string }> = [];
		const runner: HttpRunner = (request) => {
			calls.push({ method: request.method, body: request.body });
			return Promise.resolve(calls.length === 1 ? redirect("https://1.1.1.1/result", 303) : html());
		};
		await runFetch("https://1.1.1.1/start", baseRequest({ method: "POST", body: "a=1" }), CONFIG, undefined, {
			http: runner,
		});
		expect(calls[0]).toEqual({ method: "POST", body: "a=1" });
		expect(calls[1]).toEqual({ method: "GET", body: undefined });
	});

	test("passes POST body and custom headers, keeping the config headers", async () => {
		let received: Parameters<HttpRunner>[0] | undefined;
		const runner: HttpRunner = (request) => {
			received = request;
			return Promise.resolve(html());
		};
		await runFetch(
			"https://1.1.1.1/start",
			baseRequest({ method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }),
			CONFIG,
			undefined,
			{ http: runner },
		);
		expect(received?.method).toBe("POST");
		expect(received?.body).toBe("{}");
		expect(received?.headers?.["Content-Type"]).toBe("application/json");
		expect(received?.headers?.["User-Agent"]).toBe(CONFIG.userAgent);
		expect(received?.redirect).toBe("manual");
	});
});

describe("runFetch charset", () => {
	test("decodes a page whose header declares GBK", async () => {
		const page = gbkPage("");
		page.contentType = "text/html; charset=gbk";
		const runner: HttpRunner = () => Promise.resolve(page);
		const result = await runFetch("https://1.1.1.1/gbk", baseRequest(), CONFIG, undefined, { http: runner });
		expect(result.text).toContain("中文页面");
		expect(result.text).not.toContain("\uFFFD");
	});

	test("falls back to the page's own <meta charset>", async () => {
		const runner: HttpRunner = () => Promise.resolve(gbkPage('<meta charset="gbk">'));
		const result = await runFetch("https://1.1.1.1/gbk", baseRequest(), CONFIG, undefined, { http: runner });
		expect(result.text).toContain("中文页面");
		expect(result.text).not.toContain("\uFFFD");
	});

	test("keeps using the decoded body when raw bytes are absent", async () => {
		const page = { ...html("<article><p>Hello</p></article>"), bytes: undefined };
		const runner: HttpRunner = () => Promise.resolve(page);
		const result = await runFetch("https://1.1.1.1/start", baseRequest(), CONFIG, undefined, { http: runner });
		expect(result.text).toContain("Hello");
	});
});

describe("runFetch PDF", () => {
	const runner: HttpRunner = () => Promise.resolve(pdfResponse());

	test("extracts PDF text with the injected extractor", async () => {
		const pdf: PdfExtractor = async () => "PDF body";
		const page = await runFetch("https://1.1.1.1/file.pdf", baseRequest(), CONFIG, undefined, { http: runner, pdf });
		expect(page.text).toBe("PDF body");
	});

	test("falls back to a note when extraction fails", async () => {
		const pdf: PdfExtractor = async () => {
			throw new Error("no unpdf");
		};
		const page = await runFetch("https://1.1.1.1/file.pdf", baseRequest(), CONFIG, undefined, { http: runner, pdf });
		expect(page.text).toContain("PDF text extraction failed");
		expect(page.text).toContain("no unpdf");
	});

	test("returns the binary note when PDF is disabled", async () => {
		const page = await runFetch(
			"https://1.1.1.1/file.pdf",
			baseRequest(),
			{ ...CONFIG, pdfEnabled: false },
			undefined,
			{ http: runner },
		);
		expect(page.text).toContain("binary content");
	});
});

const SCHEMA_CONFIG = { ...DEFAULT_FETCH_CONFIG, maxOutputChars: 5000 };

describe("resolveRequest", () => {
	test("accepts a single url", () => {
		const request = resolveRequest({ url: "https://example.com/" }, SCHEMA_CONFIG);
		expect(request.url).toBe("https://example.com/");
		expect(request.startIndex).toBe(0);
		expect(request.maxChars).toBe(5000);
		expect(request.mode).toBe("insensitive");
		expect(request.contextChars).toBe(200);
		expect(request.maxMatches).toBe(8);
		expect(request.find).toEqual([]);
		expect(request.refresh).toBe(false);
	});

	test("trims the url", () => {
		expect(resolveRequest({ url: " https://a/ " }, SCHEMA_CONFIG).url).toBe("https://a/");
	});

	test("rejects no url", () => {
		expect(() => resolveRequest({} as WebFetchArgs, SCHEMA_CONFIG)).toThrow("url is required");
		expect(() => resolveRequest({ url: "  " }, SCHEMA_CONFIG)).toThrow("url is required");
	});

	test("rejects an over-long url", () => {
		expect(() => resolveRequest({ url: `https://x/${"a".repeat(3000)}` }, SCHEMA_CONFIG)).toThrow("at most");
	});

	test("clamps maxChars to the configured ceiling", () => {
		expect(resolveRequest({ url: "https://a/", maxChars: 99_999 }, SCHEMA_CONFIG).maxChars).toBe(5000);
		expect(resolveRequest({ url: "https://a/", maxChars: 1 }, SCHEMA_CONFIG).maxChars).toBe(200);
	});

	test("normalizes find and the mode", () => {
		const request = resolveRequest(
			{ url: "https://a/", find: ["  one  ", "", "two"], mode: "fuzzy" as const },
			SCHEMA_CONFIG,
		);
		expect(request.find).toEqual(["one", "two"]);
		expect(request.mode).toBe("fuzzy");
	});

	test("defaults to a cacheable GET", () => {
		const request = resolveRequest({ url: "https://a/" }, SCHEMA_CONFIG);
		expect(request.method).toBe("GET");
		expect(request.headers).toEqual({});
		expect(request.body).toBeUndefined();
		expect(request.cacheable).toBe(true);
	});

	test("a body implies POST and disables caching", () => {
		const request = resolveRequest({ url: "https://a/", body: "{}" }, SCHEMA_CONFIG);
		expect(request.method).toBe("POST");
		expect(request.body).toBe("{}");
		expect(request.cacheable).toBe(false);
	});

	test("rejects a body with an explicit GET", () => {
		expect(() => resolveRequest({ url: "https://a/", method: "GET", body: "{}" }, SCHEMA_CONFIG)).toThrow(
			'method "POST"',
		);
	});

	test("normalizes headers and disables caching for custom headers", () => {
		const request = resolveRequest({ url: "https://a/", headers: { " X-Token ": " abc " } }, SCHEMA_CONFIG);
		expect(request.headers).toEqual({ "X-Token": "abc" });
		expect(request.cacheable).toBe(false);
	});

	test("rejects transport and malformed headers", () => {
		expect(() => resolveRequest({ url: "https://a/", headers: { Host: "evil" } }, SCHEMA_CONFIG)).toThrow(
			"not allowed",
		);
		expect(() => resolveRequest({ url: "https://a/", headers: { X: "a\r\nb" } }, SCHEMA_CONFIG)).toThrow(
			"invalid character",
		);
	});

	test("clamps the body against maxBodyChars", () => {
		expect(() =>
			resolveRequest({ url: "https://a/", body: "x".repeat(SCHEMA_CONFIG.maxBodyChars + 1) }, SCHEMA_CONFIG),
		).toThrow("body is longer");
	});
});

function lookupReturning(...addresses: string[]): LookupImpl {
	return (async () => addresses.map((address) => ({ address }))) as unknown as LookupImpl;
}

describe("isBlockedIp", () => {
	test("blocks loopback, private, link-local, and metadata ranges", () => {
		for (const ip of [
			"127.0.0.1",
			"10.1.2.3",
			"172.16.0.1",
			"192.168.1.1",
			"169.254.169.254",
			"0.0.0.0",
			"224.0.0.1",
		]) {
			expect(isBlockedIp(ip)).toBe(true);
		}
	});

	test("blocks IPv6 loopback, unique-local, and link-local", () => {
		for (const ip of ["::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
			expect(isBlockedIp(ip)).toBe(true);
		}
	});

	test("blocks every encoding of an embedded IPv4 address", () => {
		for (const ip of [
			"::ffff:127.0.0.1",
			"::ffff:7f00:1",
			"0:0:0:0:0:ffff:7f00:1",
			"::7f00:1",
			"::ffff:0:7f00:1",
			"64:ff9b::7f00:1",
			"64:ff9b::a00:1",
			"2002:7f00:0001::",
		]) {
			expect(isBlockedIp(ip)).toBe(true);
		}
		expect(isBlockedIp("64:ff9b::808:808")).toBe(false);
		expect(isBlockedIp("2002:0808:0808::")).toBe(false);
	});

	test("allows public addresses", () => {
		for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
			expect(isBlockedIp(ip)).toBe(false);
		}
	});
});

describe("isBlockedHostname", () => {
	test("blocks obvious internal names", () => {
		for (const host of ["localhost", "sub.localhost", "foo.local", "x.internal", "metadata.google.internal"]) {
			expect(isBlockedHostname(host)).toBe(true);
		}
	});

	test("allows normal public names", () => {
		for (const host of ["example.com", "en.wikipedia.org"]) {
			expect(isBlockedHostname(host)).toBe(false);
		}
	});
});

describe("assertAllowedUrl", () => {
	test("accepts a public http(s) url", async () => {
		const url = await assertAllowedUrl("https://example.com/page", false, lookupReturning("93.184.216.34"));
		expect(url.hostname).toBe("example.com");
	});

	test("rejects a non-http scheme and invalid urls", async () => {
		await expect(assertAllowedUrl("ftp://example.com/", false, lookupReturning("1.1.1.1"))).rejects.toThrow(SsrfError);
		await expect(assertAllowedUrl("not a url", false, lookupReturning("1.1.1.1"))).rejects.toThrow(SsrfError);
	});

	test("rejects internal hostnames and literal addresses", async () => {
		await expect(assertAllowedUrl("http://localhost:8080/", false, lookupReturning("127.0.0.1"))).rejects.toThrow(
			SsrfError,
		);
		await expect(assertAllowedUrl("http://10.0.0.5/", false, lookupReturning("10.0.0.5"))).rejects.toThrow(SsrfError);
	});

	test("rejects a public name that resolves to a private address", async () => {
		await expect(assertAllowedUrl("https://evil.example/", false, lookupReturning("10.0.0.1"))).rejects.toThrow(
			SsrfError,
		);
	});

	test("reports a resolution failure", async () => {
		const failing = (async () => {
			throw new Error("ENOTFOUND");
		}) as unknown as LookupImpl;
		await expect(assertAllowedUrl("https://nope.example/", false, failing)).rejects.toThrow(/Could not resolve/);
	});

	test("skips checks when private hosts are allowed", async () => {
		const failIfCalled = (async () => {
			throw new Error("should not resolve");
		}) as unknown as LookupImpl;
		const url = await assertAllowedUrl("http://localhost/", true, failIfCalled);
		expect(url.hostname).toBe("localhost");
	});
});

describe("web_fetch tool", () => {
	const DEFAULT_HTML =
		"<html><head><title>Example</title></head><body><article><p>Hello page</p></article></body></html>";
	const ctx = { cwd: tempDir("web-access-fetch-cwd-"), mode: "tui", hasUI: true };

	interface FetchTool {
		execute: (
			id: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
			onUpdate?: unknown,
			context?: unknown,
		) => Promise<{
			content: Array<{ type: string; text: string }>;
			details: FetchResponse;
			structuredContent: FetchResponse;
			isError?: boolean;
		}>;
	}

	function installTool(runner?: HttpRunner) {
		const { pi, tools } = createFakePi();
		registerFetchTool(pi, { http: runner });
		return { pi, tool: tools.get(TOOL_NAME) as FetchTool };
	}

	function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
		return { ...htmlResponse(DEFAULT_HTML, "https://1.1.1.1/page"), ...overrides };
	}

	beforeEach(() => {
		useEnv({ PI_CODING_AGENT_DIR: tempDir("web-access-fetch-agent-") });
	});

	test("registers web_fetch as a direct, active, parallel, read-only tool", () => {
		const { pi, tools } = createFakePi();
		registerFetchTool(pi);
		const tool = tools.get(TOOL_NAME);
		expect(tool).toBeDefined();
		expect(tool.exposure).toBeUndefined();
		expect(tool.defaultActive).toBeUndefined();
		expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
		expect(tool.executionMode).toBeUndefined();
		expect(tool.outputSchema).toBeDefined();
	});

	test("execute returns the page text, details, and matching structuredContent", async () => {
		const { tool } = installTool(() => Promise.resolve(httpResponse()));

		const result = await tool.execute("call-1", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);
		const page = result.details;

		expect(result.content[0].text).toContain("Title: Example");
		expect(result.content[0].text).toContain("Hello page");
		expect(page.title).toBe("Example");
		expect(page.cached).toBe(false);
		expect(page.error).toBe("");
		expect(page.matches).toEqual([]);
		expect(page.matchesTruncated).toBe(false);
		expect(result.structuredContent).toEqual(result.details);
	});

	test("keeps the paging hint and exposes the next index in details", async () => {
		const long = `<html><head><title>Long</title></head><body><article><p>${"word ".repeat(60_000)}</p></article></body></html>`;
		const { tool } = installTool(() => Promise.resolve(htmlResponse(long, "https://1.1.1.1/long")));

		const result = await tool.execute("call-long", { url: "https://1.1.1.1/long" }, undefined, undefined, ctx);
		const page = result.details;

		expect(page.truncated).toBe(true);
		expect(page.nextIndex).toBeGreaterThan(0);
		expect(result.content[0].text).toContain(`call web_fetch again with startIndex=${page.nextIndex}`);
		expect(Array.from(result.content[0].text).length).toBeLessThanOrEqual(20_000);

		const next = await tool.execute(
			"call-long-2",
			{ url: "https://1.1.1.1/long", startIndex: page.nextIndex },
			undefined,
			undefined,
			ctx,
		);
		expect(next.details.startIndex).toBe(page.nextIndex);
		expect(next.details.text.length).toBeGreaterThan(0);
	});

	test("find returns matching passages with offsets", async () => {
		const { tool } = installTool(() => Promise.resolve(httpResponse()));

		const result = await tool.execute(
			"call-2",
			{ url: "https://1.1.1.1/page", find: ["Hello"] },
			undefined,
			undefined,
			ctx,
		);
		const page = result.details;

		expect(result.content[0].text).toContain("Matches for");
		expect(page.matches).toHaveLength(1);
		expect(page.matches[0].passage).toContain("Hello page");
		expect(page.matchesTruncated).toBe(false);
	});

	test("notes when a find result hit the match cap", async () => {
		const body = `<html><head><title>Many</title></head><body><article><p>${"hit ".repeat(50)}</p></article></body></html>`;
		const { tool } = installTool(() => Promise.resolve(htmlResponse(body, "https://1.1.1.1/many")));

		const result = await tool.execute(
			"call-find-cap",
			{ url: "https://1.1.1.1/many", find: ["hit"], maxMatches: 3 },
			undefined,
			undefined,
			ctx,
		);
		const page = result.details;

		expect(page.matches).toHaveLength(3);
		expect(page.matchesTruncated).toBe(true);
		expect(result.content[0].text).toContain("raise maxMatches");
	});

	test("notes when the character budget hid matches", async () => {
		const paragraph = `<p>hit ${"x".repeat(150)}</p>`;
		const body = `<html><head><title>Many</title></head><body><article>${paragraph.repeat(10)}</article></body></html>`;
		const { tool } = installTool(() => Promise.resolve(htmlResponse(body, "https://1.1.1.1/many")));

		const result = await tool.execute(
			"call-find-budget",
			{ url: "https://1.1.1.1/many", find: ["hit"], maxMatches: 10, contextChars: 150, maxChars: 400 },
			undefined,
			undefined,
			ctx,
		);
		const page = result.details;

		expect(page.matches.length).toBeLessThan(10);
		expect(page.matchesTruncated).toBe(true);
		expect(Array.from(result.content[0].text).length).toBeLessThanOrEqual(400);
		expect(result.content[0].text).toContain(`showing ${page.matches.length} of 10 matches`);
	});

	test("serves a second call from the cache without refetching", async () => {
		let calls = 0;
		const { tool } = installTool(() => {
			calls++;
			return Promise.resolve(httpResponse());
		});

		const first = await tool.execute("call-3", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);
		const second = await tool.execute("call-4", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);

		expect(calls).toBe(1);
		expect(first.details.cached).toBe(false);
		expect(second.details.cached).toBe(true);
	});

	test("clears the cache on session_start and session_shutdown", async () => {
		let calls = 0;
		const { pi, tool } = installTool(() => {
			calls++;
			return Promise.resolve(httpResponse());
		});

		await tool.execute("call-c1", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);
		await emit(pi, "session_start", { type: "session_start" }, ctx);
		await tool.execute("call-c2", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);
		await emit(pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		await tool.execute("call-c3", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);

		expect(calls).toBe(3);
	});

	test("refresh bypasses the cache", async () => {
		let calls = 0;
		const { tool } = installTool(() => {
			calls++;
			return Promise.resolve(httpResponse());
		});

		await tool.execute("call-5", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);
		const refreshed = await tool.execute(
			"call-6",
			{ url: "https://1.1.1.1/page", refresh: true },
			undefined,
			undefined,
			ctx,
		);

		expect(calls).toBe(2);
		expect(refreshed.details.cached).toBe(false);
	});

	test("does not cache a POST and passes method/body/headers", async () => {
		let calls = 0;
		const seen: Array<{ method?: string; body?: string }> = [];
		const { tool } = installTool((request) => {
			calls++;
			seen.push({ method: request.method, body: request.body });
			return Promise.resolve(httpResponse());
		});

		const args = {
			url: "https://1.1.1.1/page",
			method: "POST" as const,
			body: "{}",
			headers: { "Content-Type": "application/json" },
		};
		await tool.execute("call-post-1", args, undefined, undefined, ctx);
		const second = await tool.execute("call-post-2", args, undefined, undefined, ctx);

		expect(calls).toBe(2);
		expect(second.details.cached).toBe(false);
		expect(seen[0]).toEqual({ method: "POST", body: "{}" });
	});

	test("refuses an internal target without calling the runner", async () => {
		const { tool } = installTool(() => {
			throw new Error("the runner must not be called");
		});

		const result = await tool.execute("call-12", { url: "http://127.0.0.1/" }, undefined, undefined, ctx);
		expect(result.details.error).toMatch(/Refusing to fetch internal/);
		expect(result.isError).toBe(true);
	});

	test("rejects a missing url before any request", async () => {
		const { tool } = installTool(() => {
			throw new Error("the runner must not be called");
		});

		await expect(tool.execute("call-13", {}, undefined, undefined, ctx)).rejects.toThrow("url is required");
	});

	function renderer(): {
		renderCall: (args: unknown, theme: unknown, context: unknown) => { render: (width: number) => string[] };
		renderResult: (
			result: unknown,
			options: { expanded: boolean; isPartial?: boolean },
			theme: unknown,
			context: unknown,
		) => { render: (width: number) => string[] };
	} {
		const { pi, tools } = createFakePi();
		registerFetchTool(pi);
		return tools.get(TOOL_NAME);
	}

	const renderPage = (overrides: Partial<FetchResponse> = {}): FetchResponse => ({
		url: "https://x/",
		finalUrl: "https://x/",
		title: "",
		status: 200,
		contentType: "text/html",
		text: "",
		totalChars: 0,
		startIndex: 0,
		nextIndex: 0,
		truncated: false,
		cached: false,
		matches: [],
		matchesTruncated: false,
		fetchedAt: "now",
		error: "",
		...overrides,
	});

	const rendered = (component: { render: (width: number) => string[] }): { lines: string[]; text: string } => {
		const lines = component.render(80);
		return { lines, text: lines.join("\n") };
	};

	it("humanizes the char count, status, cache marker, and redirect target", () => {
		const tool = renderer();
		const { text } = rendered(
			tool.renderResult(
				{
					details: renderPage({ title: "Pi\u001b[31m\nHome", totalChars: 12_345, cached: true }),
					content: [{ type: "text", text: "" }],
				},
				{ expanded: false },
				fakeTheme,
				{ lastComponent: undefined },
			),
		);
		expect(text).toContain("12k chars");
		expect(text).toContain("200");
		expect(text).toContain("(cached)");
		expect(text).not.toContain("\u001b");

		const moved = rendered(
			tool.renderResult(
				{ details: renderPage({ title: "Moved", finalUrl: "https://x/new" }), content: [{ type: "text", text: "" }] },
				{ expanded: false },
				fakeTheme,
				{ lastComponent: undefined },
			),
		);
		expect(moved.text).toContain("https://x/new");
	});

	it("renders a live fetching line while partial", () => {
		const tool = renderer();
		const context = {
			args: { url: "https://example.com/a" },
			lastComponent: undefined,
			state: {},
			invalidate: () => {},
		};
		const { text } = rendered(
			tool.renderResult({ details: undefined, content: [] }, { expanded: false, isPartial: true }, fakeTheme, context),
		);
		expect(text).toContain("Fetching example.com");
		tool.renderResult(
			{ details: renderPage(), content: [{ type: "text", text: "" }] },
			{ expanded: false },
			fakeTheme,
			context,
		);
	});
});

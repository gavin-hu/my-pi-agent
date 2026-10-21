/**
 * The shared HTTP capability: charset decoding, the `web-access` config loader,
 * the native-fetch runner, and the extension entry point.
 *
 * Every request goes through an injected `fetch`, so nothing here touches the
 * network; the runner's own limits are the subject, not a shortcut around them.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_SEARCH_PROVIDER_CHANNEL } from "../../lib/events.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { tempDir, withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { bomCharset, charsetOf, decodeBytes, decodeHtml, sniffHtmlCharset } from "./charset.ts";
import { loadFetchConfig, loadSearchConfig } from "./config.ts";
import { DEFAULT_FETCH_CONFIG } from "./fetch/config.ts";
import { TOOL_NAME as FETCH_TOOL } from "./fetch/tool.ts";
import {
	createFetchRunner,
	HttpAbortError,
	HttpTimeoutError,
	HttpTooLargeError,
	HttpUnavailableError,
} from "./http.ts";
import webAccess from "./index.ts";
import { DEFAULT_SEARCH_CONFIG } from "./search/config.ts";
import { TOOL_NAME as SEARCH_TOOL } from "./search/tool.ts";

/** "中文页面" in GBK. */
const GBK_TEXT = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xd2, 0xb3, 0xc3, 0xe6]);
/** "早茶" in GBK. */
const GBK_TEA = new Uint8Array([0xd4, 0xe7, 0xb2, 0xe8]);

function ascii(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function joined(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		merged.set(part, offset);
		offset += part.length;
	}
	return merged;
}

describe("charsetOf", () => {
	const DECLARED: ReadonlyArray<[string, string | undefined]> = [
		["text/html; charset=utf-8", "utf-8"],
		["text/html;charset=gbk", "gbk"],
		['text/html; charset="GBK"', "gbk"],
		["text/html; charset = GB18030", "gb18030"],
		["text/html", undefined],
		["", undefined],
	];

	for (const [contentType, expected] of DECLARED) {
		test(`reads ${JSON.stringify(contentType)} as ${String(expected)}`, () => {
			expect(charsetOf(contentType)).toBe(expected);
		});
	}
});

describe("bomCharset", () => {
	test("recognises the three byte-order marks", () => {
		expect(bomCharset(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("utf-8");
		expect(bomCharset(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe("utf-16le");
		expect(bomCharset(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toBe("utf-16be");
	});

	test("returns undefined without a BOM", () => {
		expect(bomCharset(ascii("<html>"))).toBeUndefined();
	});
});

describe("sniffHtmlCharset", () => {
	test("reads <meta charset> in either quoting style", () => {
		expect(sniffHtmlCharset(ascii('<html><head><meta charset="gbk">'))).toBe("gbk");
		expect(sniffHtmlCharset(ascii("<html><head><meta charset=GB2312>"))).toBe("gb2312");
	});

	test("reads the http-equiv form", () => {
		const html = '<meta http-equiv="Content-Type" content="text/html; charset=gbk">';
		expect(sniffHtmlCharset(ascii(html))).toBe("gbk");
	});

	test("returns undefined when the document declares nothing", () => {
		expect(sniffHtmlCharset(ascii("<html><head><title>x</title></head></html>"))).toBeUndefined();
	});
});

describe("decodeBytes", () => {
	test("defaults to UTF-8", () => {
		expect(decodeBytes(ascii("hello"))).toBe("hello");
		expect(decodeBytes(ascii("广州早茶"))).toBe("广州早茶");
	});

	test("decodes a declared legacy charset", () => {
		expect(decodeBytes(GBK_TEXT, "gbk")).toBe("中文页面");
	});

	test("falls back to UTF-8 for an unknown label", () => {
		expect(decodeBytes(ascii("hello"), "not-a-charset")).toBe("hello");
	});
});

describe("decodeHtml", () => {
	test("honours the header charset", () => {
		expect(decodeHtml(GBK_TEXT, "text/html; charset=gbk")).toBe("中文页面");
	});

	test("falls back to the document's own <meta charset>", () => {
		const body = joined(
			ascii('<html><head><meta charset="gbk"></head><body><p>'),
			GBK_TEA,
			ascii("</p></body></html>"),
		);
		expect(decodeHtml(body, "text/html")).toContain("早茶");
	});

	test("prefers a byte-order mark over the declared charset", () => {
		const body = joined(new Uint8Array([0xef, 0xbb, 0xbf]), ascii("héllo"));
		expect(decodeHtml(body, "text/html; charset=gbk")).toBe("héllo");
	});

	test("prefers the declared charset over <meta>", () => {
		const body = joined(ascii('<html><head><meta charset="utf-8"></head><body>'), GBK_TEXT, ascii("</body></html>"));
		expect(decodeHtml(body, "text/html; charset=gbk")).toContain("中文页面");
	});
});

describe("web-access config", () => {
	test("defaults both sections when no file exists", async () => {
		await withAgentDir(() => {
			const cwd = tempDir("web-access-cwd-");
			expect(loadSearchConfig(cwd)).toEqual(DEFAULT_SEARCH_CONFIG);
			expect(loadFetchConfig(cwd)).toEqual(DEFAULT_FETCH_CONFIG);
		}, "web-access-global-");
	});

	test("merges global then project per section, project winning", async () => {
		const cwd = tempDir("web-access-cwd-");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "bytefly.json"),
			JSON.stringify({ "web-access": { search: { maxResults: 5 }, fetch: { maxOutputChars: 5000 } } }),
		);

		await withAgentDir((globalDir) => {
			writeFileSync(
				join(globalDir, "bytefly.json"),
				JSON.stringify({
					"web-access": {
						search: { maxResults: 3, language: "zh-CN" },
						fetch: { maxOutputChars: 3000, allowPrivateHosts: true },
					},
				}),
			);
			expect(loadSearchConfig(cwd).maxResults).toBe(5);
			expect(loadSearchConfig(cwd).language).toBe("zh-CN");
			expect(loadFetchConfig(cwd).maxOutputChars).toBe(5000);
			expect(loadFetchConfig(cwd).allowPrivateHosts).toBe(true);
		}, "web-access-global-");
	});

	test("keeps the sections independent", async () => {
		const cwd = tempDir("web-access-cwd-");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		// A fetch key placed in the search section must not leak into either.
		writeFileSync(
			join(cwd, ".pi", "bytefly.json"),
			JSON.stringify({ "web-access": { search: { allowPrivateHosts: true } } }),
		);

		await withAgentDir(() => {
			expect(loadSearchConfig(cwd).maxResults).toBe(DEFAULT_SEARCH_CONFIG.maxResults);
			expect(loadFetchConfig(cwd).allowPrivateHosts).toBe(false);
		}, "web-access-global-");
	});

	test("ignores malformed files", async () => {
		const cwd = tempDir("web-access-cwd-");
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), "{ not json");
			expect(loadSearchConfig(cwd)).toEqual(DEFAULT_SEARCH_CONFIG);
			expect(loadFetchConfig(cwd)).toEqual(DEFAULT_FETCH_CONFIG);
		}, "web-access-global-");
	});
});

/** A response whose body is a real stream, so the runner reads it chunk by chunk. */
function streamedResponse(chunks: string[], init: { cancel?: () => void } = {}): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
			if (!init.cancel) controller.close();
		},
		cancel() {
			init.cancel?.();
		},
	});
	return { status: 200, url: "https://x/", headers: new Headers(), body } as unknown as Response;
}

describe("createFetchRunner", () => {
	test("returns status, body, content type, final url, and size", async () => {
		const response = {
			status: 200,
			url: "https://final.example/",
			headers: new Headers({ "content-type": "text/plain; charset=utf-8" }),
			arrayBuffer: async () => new TextEncoder().encode("hello").buffer,
			text: async () => "hello",
		} as unknown as Response;
		const fetchImpl = (async () => response) as unknown as typeof fetch;
		const result = await createFetchRunner(fetchImpl)({ url: "https://start.example/", timeoutMs: 1000 });
		expect(result.status).toBe(200);
		expect(result.body).toBe("hello");
		expect(result.contentType).toContain("text/plain");
		expect(result.finalUrl).toBe("https://final.example/");
		expect(result.sizeBytes).toBe(5);
		expect(Array.from(result.bytes ?? [])).toEqual([104, 101, 108, 108, 111]);
	});

	test("decodes the body with the declared charset", async () => {
		const response = {
			status: 200,
			url: "https://x/",
			headers: new Headers({ "content-type": "text/html; charset=gbk" }),
			arrayBuffer: async () => GBK_TEXT.buffer,
		} as unknown as Response;
		const result = await createFetchRunner((async () => response) as unknown as typeof fetch)({
			url: "https://x/",
			timeoutMs: 1000,
		});
		expect(result.body).toBe("中文页面");
	});

	test("passes redirect: manual and reports the location header", async () => {
		let seen: RequestInit | undefined;
		const fetchImpl = (async (_url: string, init?: RequestInit) => {
			seen = init;
			return new Response("", { status: 302, headers: { location: "https://next.example/" } });
		}) as unknown as typeof fetch;
		const result = await createFetchRunner(fetchImpl)({
			url: "https://x/",
			timeoutMs: 1000,
			redirect: "manual",
		});
		expect(seen?.redirect).toBe("manual");
		expect(result.status).toBe(302);
		expect(result.location).toBe("https://next.example/");
	});

	test("sends method, headers, and body", async () => {
		let seen: RequestInit | undefined;
		const fetchImpl = (async (_url: string, init?: RequestInit) => {
			seen = init;
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;
		await createFetchRunner(fetchImpl)({
			url: "https://api.example/",
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: '{"a":1}',
			timeoutMs: 1000,
		});
		expect(seen?.method).toBe("POST");
		expect(seen?.body).toBe('{"a":1}');
		expect((seen?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
	});

	test("does not throw on a non-2xx status", async () => {
		const fetchImpl = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
		const result = await createFetchRunner(fetchImpl)({ url: "https://x/", timeoutMs: 1000 });
		expect(result.status).toBe(503);
	});

	test("rejects a declared content-length over the byte limit", async () => {
		const fetchImpl = (async () =>
			new Response("small", { status: 200, headers: { "content-length": "999999" } })) as unknown as typeof fetch;
		await expect(createFetchRunner(fetchImpl)({ url: "https://x/", timeoutMs: 1000, maxBytes: 10 })).rejects.toThrow(
			HttpTooLargeError,
		);
	});

	test("rejects an actual body over the byte limit", async () => {
		const fetchImpl = (async () => new Response("0123456789", { status: 200 })) as unknown as typeof fetch;
		await expect(createFetchRunner(fetchImpl)({ url: "https://x/", timeoutMs: 1000, maxBytes: 5 })).rejects.toThrow(
			HttpTooLargeError,
		);
	});

	test("assembles a multi-chunk stream under the byte limit", async () => {
		const fetchImpl = (async () => streamedResponse(["ab", "cd"])) as unknown as typeof fetch;
		const result = await createFetchRunner(fetchImpl)({ url: "https://x/", timeoutMs: 1000, maxBytes: 10 });
		expect(result.body).toBe("abcd");
		expect(result.sizeBytes).toBe(4);
	});

	test("cancels a streamed body that exceeds the byte limit", async () => {
		let cancelled = false;
		const fetchImpl = (async () =>
			streamedResponse(["0123456789"], { cancel: () => (cancelled = true) })) as unknown as typeof fetch;
		await expect(createFetchRunner(fetchImpl)({ url: "https://x/", timeoutMs: 1000, maxBytes: 5 })).rejects.toThrow(
			HttpTooLargeError,
		);
		expect(cancelled).toBe(true);
	});

	test("times out a hanging request", async () => {
		const fetchImpl = ((_url: string, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
			})) as unknown as typeof fetch;
		await expect(createFetchRunner(fetchImpl)({ url: "https://x/", timeoutMs: 10 })).rejects.toThrow(HttpTimeoutError);
	});

	test("reports caller cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		const fetchImpl = (async () => new Response("late", { status: 200 })) as unknown as typeof fetch;
		await expect(
			createFetchRunner(fetchImpl)({ url: "https://x/", timeoutMs: 1000 }, controller.signal),
		).rejects.toThrow(HttpAbortError);
	});

	test("wraps a network failure", async () => {
		const fetchImpl = (async () => {
			throw new Error("ENOTFOUND");
		}) as unknown as typeof fetch;
		await expect(createFetchRunner(fetchImpl)({ url: "https://x/", timeoutMs: 1000 })).rejects.toThrow(
			HttpUnavailableError,
		);
	});
});

describe("web-access extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "web-access" }, () => {
			const { pi, tools, handlers } = createFakePi();
			webAccess(pi);
			expect(tools.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers both tools with the fetch cache lifecycle", () => {
		const { pi, tools, handlers } = createFakePi();
		webAccess(pi);

		expect([...tools.keys()].sort()).toEqual([SEARCH_TOOL, FETCH_TOOL].sort());
		expect(handlers.has("session_start")).toBe(true);
		expect(handlers.has("session_shutdown")).toBe(true);
	});

	test("publishes the resolved provider at session start", async () => {
		const { pi } = createFakePi();
		webAccess(pi);
		const seen: unknown[] = [];
		pi.events.on(WEB_SEARCH_PROVIDER_CHANNEL, (facts: unknown) => seen.push(facts));

		for (const handler of pi.handlers.get("session_start") ?? []) {
			await handler({}, { cwd: tempDir("web-access-facts-") });
		}

		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ provider: "duckduckgo", reason: "default", configured: true });
	});

	test("a throwing bus listener does not break the session", async () => {
		const { pi } = createFakePi();
		webAccess(pi);
		pi.events.on(WEB_SEARCH_PROVIDER_CHANNEL, () => {
			throw new Error("listener exploded");
		});

		for (const handler of pi.handlers.get("session_start") ?? []) {
			await handler({}, { cwd: tempDir("web-access-facts-") });
		}
	});
});

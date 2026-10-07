import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type WebSearchConfig } from "../../extensions/web-search/config.ts";
import { CurlAbortError, CurlTimeoutError, CurlUnavailableError, type HttpPoster, type HttpPostRequest } from "../../extensions/web-search/curl.ts";
import {
	KP_BY_SAFE_SEARCH,
	resetThrottle,
	searchDuckDuckGo,
	setDefaultHttpPosterForTests,
	WebSearchError,
} from "../../extensions/web-search/duckduckgo.ts";
import type { SearchRequest } from "../../extensions/web-search/types.ts";

const RESULT_HTML = `
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="https://example.com/">Example</a>
  <a class="result__snippet">A snippet.</a>
</div>
`;

const request: SearchRequest = { query: "pi coding agent", maxResults: 5, region: "wt-wt", safeSearch: "moderate" };

function configWith(overrides: Partial<WebSearchConfig> = {}): WebSearchConfig {
	resetThrottle();
	return { ...DEFAULT_CONFIG, minIntervalMs: 0, ...overrides };
}

function recordingPoster(result: { status: number; body: string } = { status: 200, body: RESULT_HTML }) {
	const seen: HttpPostRequest[] = [];
	const poster: HttpPoster = (req) => {
		seen.push(req);
		return Promise.resolve(result);
	};
	return { poster, seen };
}

afterEach(() => setDefaultHttpPosterForTests(undefined));

describe("searchDuckDuckGo", () => {
	test("POSTs the form and browser headers, then parses results", async () => {
		const { poster, seen } = recordingPoster();
		const results = await searchDuckDuckGo(request, configWith(), undefined, { httpPost: poster });

		expect(seen).toHaveLength(1);
		expect(seen[0].url).toBe(DEFAULT_CONFIG.endpoint);
		expect(seen[0].form).toEqual({ q: "pi coding agent", b: "", kl: "wt-wt", kp: KP_BY_SAFE_SEARCH.moderate });
		expect(seen[0].headers["User-Agent"]).toContain("Mozilla/5.0");
		expect(seen[0].headers.Referer).toBe("https://html.duckduckgo.com/");

		expect(results).toEqual([{ title: "Example", url: "https://example.com/", snippet: "A snippet." }]);
	});

	test("maps every safe-search level to its kp value", async () => {
		for (const [level, kp] of Object.entries(KP_BY_SAFE_SEARCH)) {
			const { poster, seen } = recordingPoster();
			await searchDuckDuckGo({ ...request, safeSearch: level as SearchRequest["safeSearch"] }, configWith(), undefined, {
				httpPost: poster,
			});
			expect(seen[0].form.kp).toBe(kp);
		}
	});

	test("passes the region through as kl", async () => {
		const { poster, seen } = recordingPoster();
		await searchDuckDuckGo({ ...request, region: "cn-zh" }, configWith(), undefined, { httpPost: poster });
		expect(seen[0].form.kl).toBe("cn-zh");
	});

	test("throws a clear error on the anti-bot challenge page", async () => {
		const { poster } = recordingPoster({ status: 200, body: '<form id="challenge-form"></form>' });
		await expect(searchDuckDuckGo(request, configWith(), undefined, { httpPost: poster })).rejects.toThrow(
			/anti-bot challenge/,
		);
	});

	test("throws on a non-2xx response", async () => {
		const { poster } = recordingPoster({ status: 503, body: "nope" });
		await expect(searchDuckDuckGo(request, configWith(), undefined, { httpPost: poster })).rejects.toThrow("HTTP 503");
	});

	test("maps transport errors to readable messages", async () => {
		const cases: Array<[Error, RegExp]> = [
			[new CurlAbortError(), /Search aborted/],
			[new CurlTimeoutError(10), /Search timed out after 10ms/],
			[new CurlUnavailableError("curl failed: boom"), /curl failed: boom/],
		];
		for (const [error, expected] of cases) {
			const poster: HttpPoster = () => Promise.reject(error);
			await expect(searchDuckDuckGo(request, configWith({ timeoutMs: 10 }), undefined, { httpPost: poster })).rejects.toThrow(
				expected,
			);
		}
	});

	test("reports an aborted caller signal before the transport error", async () => {
		const controller = new AbortController();
		controller.abort();
		const poster: HttpPoster = () => Promise.reject(new Error("ignored"));
		await expect(searchDuckDuckGo(request, configWith(), controller.signal, { httpPost: poster })).rejects.toThrow(
			"Search aborted",
		);
	});

	test("spaces requests out by minIntervalMs", async () => {
		resetThrottle();
		const { poster } = recordingPoster();
		const config = configWith({ minIntervalMs: 50 });
		await searchDuckDuckGo(request, config, undefined, { httpPost: poster });
		const start = Date.now();
		await searchDuckDuckGo(request, config, undefined, { httpPost: poster });
		expect(Date.now() - start).toBeGreaterThanOrEqual(30);
	});

	test("uses a custom user agent when configured", async () => {
		const { poster, seen } = recordingPoster();
		await searchDuckDuckGo(request, configWith({ userAgent: "my-bot/1.0" }), undefined, { httpPost: poster });
		expect(seen[0].headers["User-Agent"]).toBe("my-bot/1.0");
	});

	test("falls back to the test poster override when no deps are passed", async () => {
		const { poster, seen } = recordingPoster();
		setDefaultHttpPosterForTests(poster);
		const results = await searchDuckDuckGo(request, configWith(), undefined);
		expect(seen).toHaveLength(1);
		expect(results).toHaveLength(1);
	});

	test("WebSearchError is an Error subclass", () => {
		expect(new WebSearchError("x")).toBeInstanceOf(Error);
	});
});

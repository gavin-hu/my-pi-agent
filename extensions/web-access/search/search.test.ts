import { describe, expect, test } from "bun:test";
import { DEFAULT_SEARCH_CONFIG } from "./config.ts";
import type { HttpRunner } from "../http.ts";
import { HttpUnavailableError } from "../http.ts";
import { createThrottle, runSearch, WebSearchError, type Throttle } from "./search.ts";
import type { SearchRequest } from "./types.ts";
import { jsonResponse } from "../../../test/helpers/fixtures/web-access.ts";
import { makeClock } from "../../../test/helpers/clock.ts";
import { withEnv } from "../../../test/helpers/env.ts";

const request: SearchRequest = { query: "pi agent", maxResults: 5 };
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
		const outcome = await runSearch(request, searxngConfig, undefined, { http: runner, throttle: noThrottle });
		expect(outcome.provider).toBe("searxng");
		expect(outcome.answer).toBe("Pi is a harness.");
		expect(outcome.results).toEqual([{ title: "Pi", url: "https://pi.dev/", snippet: "A harness." }]);
	});

	test("uses the keyless DuckDuckGo provider when nothing is configured", async () => {
		const runner = searxngRunner({
			AbstractText: "Pi is a harness.",
			RelatedTopics: [{ FirstURL: "https://pi.dev/", Text: '<a href="https://pi.dev/">Pi</a>A harness.' }],
		});
		const outcome = await runSearch(request, keylessConfig, undefined, { http: runner, throttle: noThrottle });
		expect(outcome.provider).toBe("duckduckgo");
		expect(outcome.answer).toBe("Pi is a harness.");
		expect(outcome.results).toEqual([{ title: "Pi", url: "https://pi.dev/", snippet: "A harness." }]);
	});

	test("resolves Brave when a key is present under auto", async () => {
		const config = { ...DEFAULT_SEARCH_CONFIG, minIntervalMs: 0, apiKey: "k" };
		const runner = searxngRunner({ web: { results: [{ title: "Pi", url: "https://pi.dev/", description: "x" }] } });
		const outcome = await runSearch(request, config, undefined, { http: runner, throttle: noThrottle });
		expect(outcome.provider).toBe("brave");
		expect(outcome.results).toHaveLength(1);
	});

	test("returns none when the provider has no results", async () => {
		const outcome = await runSearch(request, searxngConfig, undefined, {
			http: searxngRunner({}),
			throttle: noThrottle,
		});
		expect(outcome).toEqual({ provider: "none", answer: "", results: [] });
	});

	test("caps results at maxResults", async () => {
		const results = Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, url: `https://x/${i}`, content: "" }));
		const outcome = await runSearch({ ...request, maxResults: 3 }, searxngConfig, undefined, {
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
			runSearch(request, { ...searxngConfig, endpoint: "" }, undefined, { http: runner, throttle: noThrottle }),
		).rejects.toThrow("search.endpoint");
		await expect(
			runSearch(request, { ...braveConfig, apiKey: "" }, undefined, { http: runner, throttle: noThrottle }),
		).rejects.toThrow("apiKeyEnv");
	});

	test("surfaces a non-2xx response as a search failure", async () => {
		await expect(
			runSearch(request, searxngConfig, undefined, { http: searxngRunner("boom", 500), throttle: noThrottle }),
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
		await expect(runSearch(request, searxngConfig, undefined, { http: runner, throttle: noThrottle })).rejects.toThrow(
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
		const config = { ...searxngConfig, minIntervalMs: 250 };
		await runSearch(request, config, undefined, { http: searxngRunner({}), throttle });
		expect(waited).toEqual([250]);
	});

	test("sends a bearer token resolved from the environment to SearXNG", async () => {
		await withEnv({ WEB_ACCESS_TEST_KEY: "secret" }, async () => {
			let authorization: string | undefined;
			const runner: HttpRunner = (req) => {
				authorization = req.headers?.Authorization;
				return Promise.resolve(jsonResponse({ results: [{ title: "Pi", url: "https://pi.dev/" }] }));
			};
			await runSearch(request, { ...searxngConfig, apiKeyEnv: "WEB_ACCESS_TEST_KEY", minIntervalMs: 0 }, undefined, {
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
			runSearch(request, searxngConfig, controller.signal, { http: runner, throttle: noThrottle }),
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
		await throttle.wait(40, undefined); // schedules the next slot at t=40
		clock.advance(10);
		await throttle.wait(40, undefined); // 30ms remain
		expect(slept).toEqual([30]);
	});
});

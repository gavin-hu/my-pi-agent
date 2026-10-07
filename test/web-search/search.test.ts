import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../extensions/web-search/config.ts";
import type { HttpResponse, HttpRunner } from "../../extensions/web-search/http.ts";
import { HttpUnavailableError } from "../../extensions/web-search/http.ts";
import { resetThrottle, runSearch, setDefaultRunnerForTests, WebSearchError } from "../../extensions/web-search/search.ts";
import type { SearchRequest } from "../../extensions/web-search/types.ts";

const request: SearchRequest = { query: "pi agent", maxResults: 5, source: "auto" };
const config = { ...DEFAULT_CONFIG, minIntervalMs: 0 };

afterEach(() => setDefaultRunnerForTests(undefined));

function json(body: unknown, status = 200): HttpResponse {
	const text = typeof body === "string" ? body : JSON.stringify(body);
	return { status, body: text, contentType: "application/json", finalUrl: "https://x/", sizeBytes: text.length };
}

function routingRunner(handlers: { instant: () => HttpResponse; wiki: () => HttpResponse }): HttpRunner {
	return (req) => {
		const host = new URL(req.url).hostname;
		return Promise.resolve(host === "api.duckduckgo.com" ? handlers.instant() : handlers.wiki());
	};
}

describe("runSearch", () => {
	test("uses the instant answer when it has content", async () => {
		const runner = routingRunner({
			instant: () =>
				json({
					AbstractText: "Pi is a harness.",
					AbstractSource: "Wikipedia",
					AbstractURL: "https://en.wikipedia.org/wiki/Pi",
					RelatedTopics: [{ FirstURL: "https://a.example/", Text: "Alpha" }],
				}),
			wiki: () => json({ query: {} }),
		});
		const outcome = await runSearch(request, config, undefined, { http: runner });
		expect(outcome.provider).toBe("duckduckgo");
		expect(outcome.answer).toBe("Pi is a harness. — Wikipedia (https://en.wikipedia.org/wiki/Pi)");
		expect(outcome.results).toHaveLength(1);
	});

	test("falls back to Wikipedia when the instant answer is empty", async () => {
		const runner = routingRunner({
			instant: () => json({}),
			wiki: () =>
				json({
					query: { pages: { "1": { title: "Pi", fullurl: "https://en.wikipedia.org/wiki/Pi", extract: "A harness.", index: 1 } } },
				}),
		});
		const outcome = await runSearch(request, config, undefined, { http: runner });
		expect(outcome.provider).toBe("wikipedia");
		expect(outcome.results[0].url).toBe("https://en.wikipedia.org/wiki/Pi");
	});

	test("returns none when both backends are empty", async () => {
		const runner = routingRunner({ instant: () => json({}), wiki: () => json({ query: {} }) });
		const outcome = await runSearch(request, config, undefined, { http: runner });
		expect(outcome).toEqual({ provider: "none", answer: "", results: [] });
	});

	test("still uses Wikipedia when the instant-answer request fails", async () => {
		const runner = routingRunner({
			instant: () => json("boom", 500),
			wiki: () =>
				json({ query: { pages: { "1": { title: "Pi", fullurl: "https://en.wikipedia.org/wiki/Pi", extract: "A.", index: 1 } } } }),
		});
		const outcome = await runSearch(request, config, undefined, { http: runner });
		expect(outcome.provider).toBe("wikipedia");
	});

	test("throws when every backend fails", async () => {
		const runner = routingRunner({ instant: () => json("boom", 500), wiki: () => json("boom", 500) });
		await expect(runSearch(request, config, undefined, { http: runner })).rejects.toThrow(WebSearchError);
	});

	test("caps results at maxResults", async () => {
		const topics = Array.from({ length: 10 }, (_, i) => ({ FirstURL: `https://x/${i}`, Text: `T${i}` }));
		const runner = routingRunner({ instant: () => json({ RelatedTopics: topics }), wiki: () => json({ query: {} }) });
		const outcome = await runSearch({ ...request, maxResults: 3 }, config, undefined, { http: runner });
		expect(outcome.results).toHaveLength(3);
	});

	test("uses the test runner override when no deps are passed", async () => {
		setDefaultRunnerForTests(routingRunner({ instant: () => json({ AbstractText: "x" }), wiki: () => json({ query: {} }) }));
		const outcome = await runSearch(request, config, undefined);
		expect(outcome.provider).toBe("duckduckgo");
	});

	test("propagates caller cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		const runner: HttpRunner = () => Promise.reject(new HttpUnavailableError("Request failed: aborted"));
		await expect(runSearch(request, config, controller.signal, { http: runner })).rejects.toThrow(WebSearchError);
	});

	test("source wikipedia skips the instant answer entirely", async () => {
		const hosts: string[] = [];
		const runner: HttpRunner = (req) => {
			const host = new URL(req.url).hostname;
			hosts.push(host);
			if (host === "api.duckduckgo.com") throw new Error("instant must not be called");
			return Promise.resolve(
				json({ query: { pages: { "1": { title: "Pi", fullurl: "https://en.wikipedia.org/wiki/Pi", extract: "A.", index: 1 } } } }),
			);
		};
		const outcome = await runSearch({ ...request, source: "wikipedia" }, config, undefined, { http: runner });
		expect(outcome.provider).toBe("wikipedia");
		expect(hosts).toEqual(["en.wikipedia.org"]);
	});

	test("source instant skips Wikipedia", async () => {
		const hosts: string[] = [];
		const runner: HttpRunner = (req) => {
			const host = new URL(req.url).hostname;
			hosts.push(host);
			if (host !== "api.duckduckgo.com") throw new Error("wikipedia must not be called");
			return Promise.resolve(json({}));
		};
		const outcome = await runSearch({ ...request, source: "instant" }, config, undefined, { http: runner });
		expect(outcome.provider).toBe("none");
		expect(hosts).toEqual(["api.duckduckgo.com"]);
	});

	test("auto skips the instant answer for a Wikipedia operator query", async () => {
		const hosts: string[] = [];
		const runner: HttpRunner = (req) => {
			const host = new URL(req.url).hostname;
			hosts.push(host);
			if (host === "api.duckduckgo.com") throw new Error("instant must not be called");
			return Promise.resolve(
				json({ query: { pages: { "1": { title: "早茶", fullurl: "https://zh.wikipedia.org/wiki/早茶", extract: "飲茶", index: 1 } } } }),
			);
		};
		const outcome = await runSearch({ ...request, query: "intitle:早茶" }, config, undefined, { http: runner });
		expect(outcome.provider).toBe("wikipedia");
		expect(hosts).toEqual(["zh.wikipedia.org"]);
	});

	test("a forced backend failure surfaces", async () => {
		const runner: HttpRunner = () => Promise.resolve(json("boom", 500));
		await expect(runSearch({ ...request, source: "instant" }, config, undefined, { http: runner })).rejects.toThrow(
			WebSearchError,
		);
	});
});

test("resetThrottle is callable", () => {
	resetThrottle();
});

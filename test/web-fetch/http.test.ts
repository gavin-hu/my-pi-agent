import { describe, expect, test } from "bun:test";
import {
	createFetchRunner,
	HttpAbortError,
	HttpTimeoutError,
	HttpTooLargeError,
	HttpUnavailableError,
} from "../../extensions/web-fetch/http.ts";

describe("createFetchRunner", () => {
	test("returns status, body, content type, final url, and size", async () => {
		const response = {
			status: 200,
			url: "https://final.example/",
			headers: new Headers({ "content-type": "text/plain; charset=utf-8" }),
			text: async () => "hello",
		} as unknown as Response;
		const fetchImpl = (async () => response) as unknown as typeof fetch;
		const runner = createFetchRunner(fetchImpl);
		const result = await runner({ url: "https://start.example/", timeoutMs: 1000 });
		expect(result.status).toBe(200);
		expect(result.body).toBe("hello");
		expect(result.contentType).toContain("text/plain");
		expect(result.finalUrl).toBe("https://final.example/");
		expect(result.sizeBytes).toBe(5);
	});

	test("sends method, headers, and body", async () => {
		let seen: RequestInit | undefined;
		const fetchImpl = (async (_url: string, init?: RequestInit) => {
			seen = init;
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;
		const runner = createFetchRunner(fetchImpl);
		await runner({
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

	test("rejects a response over the byte limit (content-length)", async () => {
		const fetchImpl = (async () =>
			new Response("small", { status: 200, headers: { "content-length": "999999" } })) as unknown as typeof fetch;
		await expect(createFetchRunner(fetchImpl)({ url: "https://x/", timeoutMs: 1000, maxBytes: 10 })).rejects.toThrow(
			HttpTooLargeError,
		);
	});

	test("rejects a response over the byte limit (actual body)", async () => {
		const fetchImpl = (async () => new Response("0123456789", { status: 200 })) as unknown as typeof fetch;
		await expect(createFetchRunner(fetchImpl)({ url: "https://x/", timeoutMs: 1000, maxBytes: 5 })).rejects.toThrow(
			HttpTooLargeError,
		);
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
		await expect(createFetchRunner(fetchImpl)({ url: "https://x/", timeoutMs: 1000 }, controller.signal)).rejects.toThrow(
			HttpAbortError,
		);
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

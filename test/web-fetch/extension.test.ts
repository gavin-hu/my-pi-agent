import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheClear } from "../../extensions/web-fetch/cache.ts";
import type { HttpResponse } from "../../extensions/web-fetch/http.ts";
import { setDefaultRunnerForTests } from "../../extensions/web-fetch/page.ts";
import webFetch, { TOOL_NAME } from "../../extensions/web-fetch/index.ts";

type AnyFn = (...args: any[]) => any;

function makeFakePi() {
	const tools = new Map<string, any>();
	const handlers = new Map<string, AnyFn[]>();
	const pi: any = {
		registerTool: (tool: any) => tools.set(tool.name, tool),
		on: (event: string, handler: AnyFn) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
	};
	return { pi, tools, handlers };
}

function installTool() {
	const { pi, tools, handlers } = makeFakePi();
	webFetch(pi);
	return { tool: tools.get(TOOL_NAME) as { execute: AnyFn }, handlers };
}

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
	return {
		status: 200,
		body: "<html><head><title>Example</title></head><body><article><p>Hello page</p></article></body></html>",
		contentType: "text/html; charset=utf-8",
		finalUrl: "https://1.1.1.1/page",
		sizeBytes: 100,
		...overrides,
	};
}

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "web-fetch-agent-"));
const ctx: any = { cwd: mkdtempSync(join(tmpdir(), "web-fetch-cwd-")), mode: "tui", hasUI: true };

beforeEach(() => {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	cacheClear();
});

afterEach(() => setDefaultRunnerForTests(undefined));

afterAll(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe("web-fetch extension", () => {
	test("registers web_fetch as a direct, active, read-only tool", () => {
		const { pi, tools } = makeFakePi();
		webFetch(pi);
		const tool = tools.get(TOOL_NAME);
		expect(tool).toBeDefined();
		expect(tool.exposure).toBe("direct");
		expect(tool.defaultActive).toBe(true);
		expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true, destructiveHint: false });
		expect(tool.outputSchema).toBeDefined();
		expect(typeof tool.renderCall).toBe("function");
		expect(typeof tool.renderResult).toBe("function");
	});

	test("execute returns the page text, details, and matching structuredContent", async () => {
		const { tool } = installTool();
		setDefaultRunnerForTests(() => Promise.resolve(httpResponse()));

		const result = await tool.execute("call-1", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);

		expect(result.content[0].text).toContain("Title: Example");
		expect(result.content[0].text).toContain("Hello page");
		expect(result.details.title).toBe("Example");
		expect(result.details.cached).toBe(false);
		expect(result.details.matches).toEqual([]);
		expect(result.structuredContent).toEqual(result.details);
	});

	test("find returns matching passages with offsets", async () => {
		const { tool } = installTool();
		setDefaultRunnerForTests(() => Promise.resolve(httpResponse()));

		const result = await tool.execute("call-2", { url: "https://1.1.1.1/page", find: ["Hello"] }, undefined, undefined, ctx);

		expect(result.content[0].text).toContain("Matches for");
		expect(result.details.matches).toHaveLength(1);
		expect(result.details.matches[0].passage).toContain("Hello page");
	});

	test("serves a second call from the cache without refetching", async () => {
		const { tool } = installTool();
		let calls = 0;
		setDefaultRunnerForTests(() => {
			calls++;
			return Promise.resolve(httpResponse());
		});

		const first = await tool.execute("call-3", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);
		const second = await tool.execute("call-4", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);

		expect(calls).toBe(1);
		expect(first.details.cached).toBe(false);
		expect(second.details.cached).toBe(true);
	});

	test("refresh bypasses the cache", async () => {
		const { tool } = installTool();
		let calls = 0;
		setDefaultRunnerForTests(() => {
			calls++;
			return Promise.resolve(httpResponse());
		});

		await tool.execute("call-5", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);
		const refreshed = await tool.execute("call-6", { url: "https://1.1.1.1/page", refresh: true }, undefined, undefined, ctx);

		expect(calls).toBe(2);
		expect(refreshed.details.cached).toBe(false);
	});

	test("clears the cache on session shutdown", async () => {
		const { tool, handlers } = installTool();
		let calls = 0;
		setDefaultRunnerForTests(() => {
			calls++;
			return Promise.resolve(httpResponse());
		});

		await tool.execute("call-7", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown" }, ctx);
		const after = await tool.execute("call-8", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);

		expect(calls).toBe(2);
		expect(after.details.cached).toBe(false);
	});

	test("notes binary content instead of returning it", async () => {
		const { tool } = installTool();
		setDefaultRunnerForTests(() => Promise.resolve(httpResponse({ contentType: "image/png", body: "\u0000\u0001" })));

		const result = await tool.execute("call-9", { url: "https://1.1.1.1/image.png" }, undefined, undefined, ctx);
		expect(result.details.text).toContain("binary content");
	});

	test("refuses an internal target without calling the runner", async () => {
		const { tool } = installTool();
		setDefaultRunnerForTests(() => {
			throw new Error("the runner must not be called");
		});

		await expect(tool.execute("call-10", { url: "http://127.0.0.1/" }, undefined, undefined, ctx)).rejects.toThrow(
			/Refusing to fetch internal/,
		);
	});

	test("surfaces an HTTP error status", async () => {
		const { tool } = installTool();
		setDefaultRunnerForTests(() => Promise.resolve(httpResponse({ status: 404 })));

		await expect(tool.execute("call-11", { url: "https://1.1.1.1/missing" }, undefined, undefined, ctx)).rejects.toThrow(
			"HTTP 404",
		);
	});

	test("rejects a missing url before any request", async () => {
		const { tool } = installTool();
		setDefaultRunnerForTests(() => {
			throw new Error("the runner must not be called");
		});

		await expect(tool.execute("call-12", { url: "   " }, undefined, undefined, ctx)).rejects.toThrow("url is required");
	});
});

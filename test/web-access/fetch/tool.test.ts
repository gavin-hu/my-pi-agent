import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheClear } from "../../../extensions/web-access/fetch/cache.ts";
import type { HttpResponse } from "../../../extensions/web-access/http.ts";
import { setDefaultRunnerForTests } from "../../../extensions/web-access/fetch/page.ts";
import { registerFetchTool, TOOL_NAME } from "../../../extensions/web-access/fetch/tool.ts";
import { createFakePi } from "../../helpers/fakes.ts";

type AnyFn = (...args: any[]) => any;

function makeFakePi() {
	return createFakePi();
}

function installTool() {
	const { pi, tools } = makeFakePi();
	registerFetchTool(pi);
	return { tool: tools.get(TOOL_NAME) as { execute: AnyFn } };
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

function htmlFor(url: string): HttpResponse {
	return httpResponse({
		body: `<html><head><title>T ${url}</title></head><body><article><p>content for ${url}</p></article></body></html>`,
		finalUrl: url,
	});
}

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "web-access-fetch-agent-"));
const ctx: any = { cwd: mkdtempSync(join(tmpdir(), "web-access-fetch-cwd-")), mode: "tui", hasUI: true };

beforeEach(() => {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	cacheClear();
});

afterEach(() => setDefaultRunnerForTests(undefined));

afterAll(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe("web_fetch tool", () => {
	test("registers web_fetch as a direct, active, read-only tool", () => {
		const { pi, tools } = makeFakePi();
		registerFetchTool(pi);
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
		const page = result.details.pages[0];

		expect(result.content[0].text).toContain("Title: Example");
		expect(result.content[0].text).toContain("Hello page");
		expect(page.title).toBe("Example");
		expect(page.cached).toBe(false);
		expect(page.error).toBe("");
		expect(page.matches).toEqual([]);
		expect(result.structuredContent).toEqual(result.details);
	});

	test("find returns matching passages with offsets", async () => {
		const { tool } = installTool();
		setDefaultRunnerForTests(() => Promise.resolve(httpResponse()));

		const result = await tool.execute(
			"call-2",
			{ url: "https://1.1.1.1/page", find: ["Hello"] },
			undefined,
			undefined,
			ctx,
		);
		const page = result.details.pages[0];

		expect(result.content[0].text).toContain("Matches for");
		expect(page.matches).toHaveLength(1);
		expect(page.matches[0].passage).toContain("Hello page");
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
		expect(first.details.pages[0].cached).toBe(false);
		expect(second.details.pages[0].cached).toBe(true);
	});

	test("refresh bypasses the cache", async () => {
		const { tool } = installTool();
		let calls = 0;
		setDefaultRunnerForTests(() => {
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
		expect(refreshed.details.pages[0].cached).toBe(false);
	});

	test("fetches several urls in one call", async () => {
		const { tool } = installTool();
		setDefaultRunnerForTests((req) => Promise.resolve(htmlFor(req.url)));

		const result = await tool.execute(
			"call-9",
			{ urls: ["https://1.1.1.1/a", "https://1.1.2.2/b"] },
			undefined,
			undefined,
			ctx,
		);

		expect(result.details.pages).toHaveLength(2);
		expect(result.details.pages.map((p: any) => p.title)).toEqual(["T https://1.1.1.1/a", "T https://1.1.2.2/b"]);
		expect(result.content[0].text).toContain("### https://1.1.1.1/a");
		expect(result.content[0].text).toContain("content for https://1.1.2.2/b");
		expect(result.isError).toBeUndefined();
	});

	test("a failing url does not abort the other pages", async () => {
		const { tool } = installTool();
		setDefaultRunnerForTests((req) =>
			Promise.resolve(req.url.includes("/fail") ? httpResponse({ status: 404 }) : htmlFor(req.url)),
		);

		const result = await tool.execute(
			"call-10",
			{ urls: ["https://1.1.1.1/ok", "https://1.1.2.2/fail"] },
			undefined,
			undefined,
			ctx,
		);

		expect(result.details.pages).toHaveLength(2);
		expect(result.details.pages[0].error).toBe("");
		expect(result.details.pages[1].error).toContain("HTTP 404");
		expect(result.content[0].text).toContain("ERROR: HTTP 404");
		expect(result.content[0].text).toContain("content for https://1.1.1.1/ok");
		expect(result.isError).toBeUndefined();
	});

	test("marks the result as an error only when every page fails", async () => {
		const { tool } = installTool();
		setDefaultRunnerForTests(() => Promise.resolve(httpResponse({ status: 500 })));

		const result = await tool.execute(
			"call-11",
			{ urls: ["https://1.1.1.1/a", "https://1.1.2.2/b"] },
			undefined,
			undefined,
			ctx,
		);
		expect(result.isError).toBe(true);
		expect(result.details.pages.every((page: any) => page.error)).toBe(true);
	});

	test("refuses an internal target without calling the runner", async () => {
		const { tool } = installTool();
		setDefaultRunnerForTests(() => {
			throw new Error("the runner must not be called");
		});

		const result = await tool.execute("call-12", { url: "http://127.0.0.1/" }, undefined, undefined, ctx);
		expect(result.details.pages[0].error).toMatch(/Refusing to fetch internal/);
		expect(result.isError).toBe(true);
	});

	test("rejects a missing url before any request", async () => {
		const { tool } = installTool();
		setDefaultRunnerForTests(() => {
			throw new Error("the runner must not be called");
		});

		await expect(tool.execute("call-13", {}, undefined, undefined, ctx)).rejects.toThrow("url is required");
	});

	test("rejects providing both url and urls", async () => {
		const { tool } = installTool();
		await expect(
			tool.execute("call-14", { url: "https://1.1.1.1/a", urls: ["https://1.1.2.2/b"] }, undefined, undefined, ctx),
		).rejects.toThrow("either url or urls");
	});
});

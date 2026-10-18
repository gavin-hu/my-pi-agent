import { beforeEach, describe, expect, test } from "bun:test";
import type { HttpResponse, HttpRunner } from "../http.ts";
import { registerFetchTool, TOOL_NAME } from "./tool.ts";
import { createFakePi, emit, fakeTheme } from "../../../test/helpers/fakes.ts";
import { htmlResponse } from "../../../test/helpers/fixtures/web-access.ts";
import { tempDir, useEnv } from "../../../test/helpers/env.ts";

type AnyFn = (...args: any[]) => any;

const DEFAULT_HTML =
	"<html><head><title>Example</title></head><body><article><p>Hello page</p></article></body></html>";

/** Register the tool with an injected runner; each call gets a fresh cache. */
function installTool(runner?: HttpRunner) {
	const { pi, tools } = createFakePi();
	registerFetchTool(pi, { http: runner });
	return { pi, tool: tools.get(TOOL_NAME) as { execute: AnyFn } };
}

function httpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
	return { ...htmlResponse(DEFAULT_HTML, "https://1.1.1.1/page"), ...overrides };
}

const agentDir = tempDir("web-access-fetch-agent-");
const ctx: any = { cwd: tempDir("web-access-fetch-cwd-"), mode: "tui", hasUI: true };

beforeEach(() => useEnv({ PI_CODING_AGENT_DIR: agentDir }));

describe("web_fetch tool", () => {
	test("registers web_fetch as a direct, active, read-only tool", () => {
		const { pi, tools } = createFakePi();
		registerFetchTool(pi);
		const tool = tools.get(TOOL_NAME);
		expect(tool).toBeDefined();
		// The host resolves both defaults; the definition states only what differs.
		expect(tool.exposure).toBeUndefined();
		expect(tool.defaultActive).toBeUndefined();
		expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
		// Sibling fetches run in parallel; the page cache is safe under interleaving.
		expect(tool.executionMode).toBeUndefined();
		expect(tool.outputSchema).toBeDefined();
		expect(typeof tool.renderCall).toBe("function");
		expect(typeof tool.renderResult).toBe("function");
	});

	test("execute returns the page text, details, and matching structuredContent", async () => {
		const { tool } = installTool(() => Promise.resolve(httpResponse()));

		const result = await tool.execute("call-1", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);
		const page = result.details;

		expect(result.content[0].text).toContain("Title: Example");
		expect(result.content[0].text).toContain("Hello page");
		expect(result.content[0].text).not.toContain("###");
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
		const { tool } = installTool((req) => {
			calls++;
			seen.push({ method: req.method, body: req.body });
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
});

describe("web_fetch transcript rendering", () => {
	const page = (overrides: Record<string, unknown> = {}) => ({
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

	function renderer() {
		const { pi, tools } = createFakePi();
		registerFetchTool(pi);
		return tools.get(TOOL_NAME) as any;
	}

	test("humanizes the char count and sanitizes the title", () => {
		const tool = renderer();
		const text = tool
			.renderResult(
				{
					details: page({ title: "Pi\u001b[31m\nHome", totalChars: 12345, cached: true }),
					content: [{ type: "text", text: "" }],
				},
				{ expanded: false },
				fakeTheme,
				{ lastComponent: undefined },
			)
			.render(80)
			.join("\n");
		expect(text).toContain("12k chars");
		expect(text).toContain("200");
		expect(text).toContain("(cached)");
		expect(text).not.toContain("\u001b");
	});

	test("shows the redirect target when the final URL differs", () => {
		const tool = renderer();
		const text = tool
			.renderResult(
				{
					details: page({ title: "Moved", finalUrl: "https://x/new" }),
					content: [{ type: "text", text: "" }],
				},
				{ expanded: false },
				fakeTheme,
				{ lastComponent: undefined },
			)
			.render(80)
			.join("\n");
		expect(text).toContain("https://x/new");
	});

	test("renders a live fetching line while partial", () => {
		const tool = renderer();
		const context = {
			args: { url: "https://example.com/a" },
			lastComponent: undefined,
			state: {},
			invalidate: () => {},
		};
		const text = tool
			.renderResult({ details: undefined, content: [] }, { expanded: false, isPartial: true }, fakeTheme, context)
			.render(80)
			.join("\n");
		expect(text).toContain("Fetching example.com");
		// A final render clears the repaint timer the partial one started.
		tool.renderResult(
			{ details: page(), content: [{ type: "text", text: "" }] },
			{ expanded: false },
			fakeTheme,
			context,
		);
	});

	test("shows an error line for a failed page and reuses the slot Text", () => {
		const tool = renderer();
		const details = page({ error: "Refusing to fetch internal address" });
		const first = tool.renderResult(
			{ details, content: [{ type: "text", text: "" }] },
			{ expanded: false },
			fakeTheme,
			{ lastComponent: undefined },
		);
		expect(first.render(80).join("\n")).toContain("Error: Refusing to fetch internal address");
		const again = tool.renderResult(
			{ details, content: [{ type: "text", text: "" }] },
			{ expanded: false },
			fakeTheme,
			{ lastComponent: first },
		);
		expect(again).toBe(first);
	});
});

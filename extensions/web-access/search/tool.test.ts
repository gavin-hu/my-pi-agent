import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HttpRunner } from "../http.ts";
import type { Throttle } from "./search.ts";
import { registerSearchTool, TOOL_NAME } from "./tool.ts";
import { createFakePi, fakeTheme } from "../../../test/helpers/fakes.ts";
import { jsonResponse } from "../../../test/helpers/fixtures/web-access.ts";
import { tempDir, useEnv } from "../../../test/helpers/env.ts";

type AnyFn = (...args: any[]) => any;

const noThrottle: Throttle = { wait: () => Promise.resolve() };

function installTool(runner: HttpRunner) {
	const { pi, tools } = createFakePi();
	registerSearchTool(pi, { http: runner, throttle: noThrottle });
	return tools.get(TOOL_NAME) as { execute: AnyFn };
}

const agentDir = tempDir("web-access-search-agent-");
const cwd = tempDir("web-access-search-cwd-");
mkdirSync(join(cwd, ".pi"), { recursive: true });
writeFileSync(
	join(cwd, ".pi", "web-access.json"),
	JSON.stringify({ search: { provider: "searxng", endpoint: "https://searx.test", minIntervalMs: 0 } }),
);
const emptyCwd = tempDir("web-access-search-empty-cwd-");
const forcedCwd = tempDir("web-access-search-forced-cwd-");
mkdirSync(join(forcedCwd, ".pi"), { recursive: true });
writeFileSync(
	join(forcedCwd, ".pi", "web-access.json"),
	JSON.stringify({ search: { provider: "searxng", minIntervalMs: 0 } }),
);
const ctx: any = { cwd, mode: "tui", hasUI: true };
const emptyCtx: any = { cwd: emptyCwd, mode: "tui", hasUI: true };
const forcedCtx: any = { cwd: forcedCwd, mode: "tui", hasUI: true };

const mustNotRun: HttpRunner = () => {
	throw new Error("the runner must not be called");
};

beforeEach(() => {
	useEnv({ PI_CODING_AGENT_DIR: agentDir });
});

describe("web_search tool", () => {
	test("registers web_search as a direct, active, read-only tool", () => {
		const { pi, tools } = createFakePi();
		registerSearchTool(pi);
		const tool = tools.get(TOOL_NAME);
		expect(tool).toBeDefined();
		expect(tool.exposure).toBe("direct");
		expect(tool.defaultActive).toBe(true);
		expect(tool.executionMode).toBe("sequential");
		expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true, destructiveHint: false });
		expect(tool.outputSchema).toBeDefined();
		expect(typeof tool.renderCall).toBe("function");
		expect(typeof tool.renderResult).toBe("function");
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
});

describe("web_search transcript rendering", () => {
	function renderer() {
		const { pi, tools } = createFakePi();
		registerSearchTool(pi, { http: mustNotRun, throttle: noThrottle });
		return tools.get(TOOL_NAME) as any;
	}

	test("result separates the header and sanitizes untrusted text", () => {
		const tool = renderer();
		const details = {
			query: "pi",
			provider: "duckduckgo",
			answer: "answer\u001b[31m text",
			results: [{ title: "Title\u001b[31m\nsecond", url: "https://x/", snippet: "" }],
			truncated: false,
			fetchedAt: "now",
		};
		const lines = tool
			.renderResult({ details, content: [{ type: "text", text: "" }] }, { expanded: false }, fakeTheme, {
				lastComponent: undefined,
			})
			.render(80)
			.map((line: string) => line.trimEnd());
		expect(lines[0]).toBe("");
		expect(lines[1]).toBe("via duckduckgo · 1 result");
		expect(lines[2]).toContain("answer");
		expect(lines[3]).toContain("Title");
		expect(lines.join("\n")).not.toContain("\u001b");
	});

	test("collapsed hints at the remaining results and expanded shows them", () => {
		const tool = renderer();
		const results = Array.from({ length: 8 }, (_, i) => ({ title: `T${i}`, url: `https://x/${i}`, snippet: "" }));
		const details = { query: "q", provider: "searxng", answer: "", results, truncated: false, fetchedAt: "now" };
		const withOptions = (expanded: boolean) =>
			tool
				.renderResult({ details, content: [{ type: "text", text: "" }] }, { expanded }, fakeTheme, {
					lastComponent: undefined,
				})
				.render(80)
				.join("\n");

		const collapsed = withOptions(false);
		expect(collapsed).toContain("+3 more");
		expect(collapsed).toContain("to expand");
		expect(collapsed).not.toContain("T7");

		const expanded = withOptions(true);
		expect(expanded).toContain("T7");
		expect(expanded).not.toContain("more");
	});

	test("no results and errors are single sanitized lines", () => {
		const tool = renderer();
		const none = tool
			.renderResult(
				{
					details: { query: "z\u0007", provider: "none", answer: "", results: [], truncated: false, fetchedAt: "now" },
					content: [{ type: "text", text: "" }],
				},
				{ expanded: false },
				fakeTheme,
				{ lastComponent: undefined },
			)
			.render(80)
			.join("\n");
		expect(none).toContain("No results for");
		expect(none).not.toContain("\u0007");

		const error = tool
			.renderResult(
				{ details: undefined, content: [{ type: "text", text: "boom\u001b[31m" }], isError: true },
				{ expanded: false },
				fakeTheme,
				{ lastComponent: undefined },
			)
			.render(80)
			.join("\n");
		expect(error).toContain("Error: boom");
		expect(error).not.toContain("\u001b");
	});

	test("reuses the slot Text", () => {
		const tool = renderer();
		const first = tool.renderCall({ query: "a" }, fakeTheme, { lastComponent: undefined });
		const again = tool.renderCall({ query: "b" }, fakeTheme, { lastComponent: first });
		expect(again).toBe(first);
	});
});

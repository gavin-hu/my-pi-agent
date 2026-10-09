import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HttpRunner } from "../http.ts";
import type { Throttle } from "./search.ts";
import { registerSearchTool, TOOL_NAME } from "./tool.ts";
import { createFakePi } from "../../../test/helpers/fakes.ts";
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

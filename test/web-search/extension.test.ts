import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HttpPoster } from "../../extensions/web-search/curl.ts";
import { resetThrottle, setDefaultHttpPosterForTests } from "../../extensions/web-search/duckduckgo.ts";
import webSearch, { TOOL_NAME } from "../../extensions/web-search/index.ts";

type AnyFn = (...args: any[]) => any;

function makeFakePi() {
	const tools = new Map<string, any>();
	const pi: any = {
		registerTool: (tool: any) => tools.set(tool.name, tool),
		on: () => () => {},
	};
	return { pi, tools };
}

const RESULT_HTML = `
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="https://example.com/">Example</a>
  <a class="result__snippet">A snippet.</a>
</div>
`;

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "web-search-agent-"));
const ctx: any = { cwd: mkdtempSync(join(tmpdir(), "web-search-ext-")), mode: "tui", hasUI: true };

beforeEach(() => {
	// Keep config reads away from the real ~/.pi/agent.
	process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	resetThrottle();
	setDefaultHttpPosterForTests(undefined);
});

afterAll(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

function installTool() {
	const { pi, tools } = makeFakePi();
	webSearch(pi);
	return tools.get(TOOL_NAME) as { execute: AnyFn };
}

describe("web-search extension", () => {
	test("registers web_search as a direct, active, read-only tool", () => {
		const { pi, tools } = makeFakePi();
		webSearch(pi);
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
		const tool = installTool();
		const poster: HttpPoster = () => Promise.resolve({ status: 200, body: RESULT_HTML });
		setDefaultHttpPosterForTests(poster);

		const result = await tool.execute("call-1", { query: "test query" }, undefined, undefined, ctx);

		expect(result.content[0].text).toContain("Example");
		expect(result.details.provider).toBe("duckduckgo");
		expect(result.details.results).toHaveLength(1);
		expect(result.structuredContent).toEqual(result.details);
	});

	test("execute surfaces a search failure as a thrown error", async () => {
		const tool = installTool();
		setDefaultHttpPosterForTests(() => Promise.resolve({ status: 502, body: "nope" }));

		await expect(tool.execute("call-2", { query: "x" }, undefined, undefined, ctx)).rejects.toThrow("HTTP 502");
	});

	test("rejects an empty query before any request", async () => {
		const tool = installTool();
		setDefaultHttpPosterForTests(() => {
			throw new Error("the poster must not be called");
		});

		await expect(tool.execute("call-3", { query: "   " }, undefined, undefined, ctx)).rejects.toThrow("query is required");
	});
});

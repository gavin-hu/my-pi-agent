import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HttpResponse, HttpRunner } from "../../extensions/_shared/http.ts";
import { resetThrottle, setDefaultRunnerForTests } from "../../extensions/web-search/search.ts";
import webSearch, { TOOL_NAME } from "../../extensions/web-search/index.ts";
import { createFakePi } from "../helpers/fakes.ts";

type AnyFn = (...args: any[]) => any;

function makeFakePi() {
	return createFakePi();
}

function installTool() {
	const { pi, tools } = makeFakePi();
	webSearch(pi);
	return tools.get(TOOL_NAME) as { execute: AnyFn };
}

function json(body: unknown, status = 200): HttpResponse {
	const text = typeof body === "string" ? body : JSON.stringify(body);
	return { status, body: text, contentType: "application/json", finalUrl: "https://x/", sizeBytes: text.length };
}

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "web-search-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "web-search-cwd-"));
mkdirSync(join(cwd, ".pi"), { recursive: true });
writeFileSync(join(cwd, ".pi", "web-search.json"), JSON.stringify({ minIntervalMs: 0 }));
const ctx: any = { cwd, mode: "tui", hasUI: true };

beforeEach(() => {
	process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	resetThrottle();
	setDefaultRunnerForTests(undefined);
});

afterAll(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

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
		const runner: HttpRunner = () =>
			Promise.resolve(json({ AbstractText: "Pi is a harness.", AbstractSource: "Wikipedia", AbstractURL: "https://en.wikipedia.org/wiki/Pi" }));
		setDefaultRunnerForTests(runner);

		const result = await tool.execute("call-1", { query: "pi agent" }, undefined, undefined, ctx);

		expect(result.content[0].text).toContain("Pi is a harness.");
		expect(result.details.provider).toBe("duckduckgo");
		expect(result.structuredContent).toEqual(result.details);
	});

	test("execute surfaces a total failure as a thrown error", async () => {
		const tool = installTool();
		setDefaultRunnerForTests(() => Promise.resolve(json("boom", 500)));

		await expect(tool.execute("call-2", { query: "x" }, undefined, undefined, ctx)).rejects.toThrow("Search failed");
	});

	test("rejects an empty query before any request", async () => {
		const tool = installTool();
		setDefaultRunnerForTests(() => {
			throw new Error("the runner must not be called");
		});

		await expect(tool.execute("call-3", { query: "   " }, undefined, undefined, ctx)).rejects.toThrow("query is required");
	});
});

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HttpResponse } from "../../extensions/web-fetch/http.ts";
import { setDefaultRunnerForTests } from "../../extensions/web-fetch/page.ts";
import webFetch, { TOOL_NAME } from "../../extensions/web-fetch/index.ts";

type AnyFn = (...args: any[]) => any;

function makeFakePi() {
	const tools = new Map<string, any>();
	const pi: any = {
		registerTool: (tool: any) => tools.set(tool.name, tool),
		on: () => () => {},
	};
	return { pi, tools };
}

function installTool() {
	const { pi, tools } = makeFakePi();
	webFetch(pi);
	return tools.get(TOOL_NAME) as { execute: AnyFn };
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
		const tool = installTool();
		setDefaultRunnerForTests(() => Promise.resolve(httpResponse()));

		const result = await tool.execute("call-1", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);

		expect(result.content[0].text).toContain("Title: Example");
		expect(result.content[0].text).toContain("Hello page");
		expect(result.details.title).toBe("Example");
		expect(result.details.status).toBe(200);
		expect(result.structuredContent).toEqual(result.details);
	});

	test("pages long text and reports the next startIndex", async () => {
		const tool = installTool();
		setDefaultRunnerForTests(() =>
			Promise.resolve(httpResponse({ contentType: "text/plain", body: "x".repeat(500), sizeBytes: 500 })),
		);

		const result = await tool.execute("call-2", { url: "https://1.1.1.1/page", maxChars: 200 }, undefined, undefined, ctx);

		expect(result.details.truncated).toBe(true);
		expect(result.details.totalChars).toBe(500);
		expect(result.content[0].text).toContain("startIndex=200");
	});

	test("notes binary content instead of returning it", async () => {
		const tool = installTool();
		setDefaultRunnerForTests(() => Promise.resolve(httpResponse({ contentType: "image/png", body: "\u0000\u0001" })));

		const result = await tool.execute("call-3", { url: "https://1.1.1.1/image.png" }, undefined, undefined, ctx);
		expect(result.details.text).toContain("binary content");
	});

	test("refuses an internal target without calling the runner", async () => {
		const tool = installTool();
		setDefaultRunnerForTests(() => {
			throw new Error("the runner must not be called");
		});

		await expect(tool.execute("call-4", { url: "http://127.0.0.1/" }, undefined, undefined, ctx)).rejects.toThrow(
			/Refusing to fetch internal/,
		);
	});

	test("surfaces an HTTP error status", async () => {
		const tool = installTool();
		setDefaultRunnerForTests(() => Promise.resolve(httpResponse({ status: 404 })));

		await expect(tool.execute("call-5", { url: "https://1.1.1.1/missing" }, undefined, undefined, ctx)).rejects.toThrow(
			"HTTP 404",
		);
	});

	test("rejects a missing url before any request", async () => {
		const tool = installTool();
		setDefaultRunnerForTests(() => {
			throw new Error("the runner must not be called");
		});

		await expect(tool.execute("call-6", { url: "   " }, undefined, undefined, ctx)).rejects.toThrow("url is required");
	});
});

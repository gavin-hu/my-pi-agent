import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HttpResponse } from "../../extensions/web-access/http.ts";
import { cacheClear } from "../../extensions/web-access/fetch/cache.ts";
import { setDefaultRunnerForTests } from "../../extensions/web-access/fetch/page.ts";
import { TOOL_NAME as FETCH_TOOL } from "../../extensions/web-access/fetch/tool.ts";
import webAccess from "../../extensions/web-access/index.ts";
import { TOOL_NAME as SEARCH_TOOL } from "../../extensions/web-access/search/tool.ts";
import { createFakePi, emit } from "../helpers/fakes.ts";

type AnyFn = (...args: any[]) => any;

function httpResponse(): HttpResponse {
	return {
		status: 200,
		body: "<html><head><title>Example</title></head><body><article><p>Hello page</p></article></body></html>",
		contentType: "text/html; charset=utf-8",
		finalUrl: "https://1.1.1.1/page",
		sizeBytes: 100,
	};
}

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "web-access-agent-"));
const ctx: any = { cwd: mkdtempSync(join(tmpdir(), "web-access-cwd-")), mode: "tui", hasUI: true };

beforeEach(() => {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	cacheClear();
});

afterEach(() => setDefaultRunnerForTests(undefined));

afterAll(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe("web-access extension", () => {
	test("registers both tools as direct and active by default", () => {
		const { pi, tools } = createFakePi();
		webAccess(pi);

		expect(tools.has(SEARCH_TOOL)).toBe(true);
		expect(tools.has(FETCH_TOOL)).toBe(true);
		expect(tools.get(SEARCH_TOOL)?.exposure).toBe("direct");
		expect(tools.get(FETCH_TOOL)?.exposure).toBe("direct");
	});

	test("clears the fetch cache on session shutdown", async () => {
		const { pi, tools } = createFakePi();
		webAccess(pi);
		const tool = tools.get(FETCH_TOOL) as { execute: AnyFn };

		let calls = 0;
		setDefaultRunnerForTests(() => {
			calls++;
			return Promise.resolve(httpResponse());
		});

		const first = await tool.execute("call-1", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);
		await emit(pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		const second = await tool.execute("call-2", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);

		expect(first.details.pages[0].cached).toBe(false);
		expect(calls).toBe(2);
		expect(second.details.pages[0].cached).toBe(false);
	});
});

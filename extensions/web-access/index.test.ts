import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cacheClear } from "./fetch/cache.ts";
import { setDefaultRunnerForTests } from "./fetch/page.ts";
import { TOOL_NAME as FETCH_TOOL } from "./fetch/tool.ts";
import webAccess from "./index.ts";
import { TOOL_NAME as SEARCH_TOOL } from "./search/tool.ts";
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import { htmlResponse } from "../../test/helpers/fixtures/web-access.ts";
import { tempDir, useEnv, withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";

type AnyFn = (...args: any[]) => any;

const PAGE_HTML = "<html><head><title>Example</title></head><body><article><p>Hello page</p></article></body></html>";

const agentDir = tempDir("web-access-agent-");
const ctx: any = { cwd: tempDir("web-access-cwd-"), mode: "tui", hasUI: true };

beforeEach(() => {
	useEnv({ PI_CODING_AGENT_DIR: agentDir });
	cacheClear();
});

afterEach(() => setDefaultRunnerForTests(undefined));

describe("web-access extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "web-access" }, () => {
			const { pi, tools, handlers } = createFakePi();
			webAccess(pi);
			expect(tools.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

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
			return Promise.resolve(htmlResponse(PAGE_HTML, "https://1.1.1.1/page"));
		});

		const first = await tool.execute("call-1", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);
		await emit(pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		const second = await tool.execute("call-2", { url: "https://1.1.1.1/page" }, undefined, undefined, ctx);

		expect(first.details.pages[0].cached).toBe(false);
		expect(calls).toBe(2);
		expect(second.details.pages[0].cached).toBe(false);
	});
});

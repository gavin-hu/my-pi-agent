import { describe, expect, test } from "bun:test";
import webAccess from "./index.ts";
import { TOOL_NAME as FETCH_TOOL } from "./fetch/tool.ts";
import { TOOL_NAME as SEARCH_TOOL } from "./search/tool.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { withEnv } from "../../test/helpers/env.ts";

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

	test("registers the fetch cache lifecycle on start and shutdown", () => {
		const { pi, handlers } = createFakePi();
		webAccess(pi);

		expect(handlers.has("session_start")).toBe(true);
		expect(handlers.has("session_shutdown")).toBe(true);
	});
});

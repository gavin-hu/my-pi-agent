import { describe, expect, test } from "bun:test";
import webAccess from "./index.ts";
import { WEB_SEARCH_PROVIDER_CHANNEL } from "../../lib/events.ts";
import { TOOL_NAME as FETCH_TOOL } from "./fetch/tool.ts";
import { TOOL_NAME as SEARCH_TOOL } from "./search/tool.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { tempDir, withEnv } from "../../test/helpers/env.ts";

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
		expect(tools.get(SEARCH_TOOL)?.exposure).toBeUndefined();
		expect(tools.get(FETCH_TOOL)?.exposure).toBeUndefined();
	});

	test("registers the fetch cache lifecycle on start and shutdown", () => {
		const { pi, handlers } = createFakePi();
		webAccess(pi);

		expect(handlers.has("session_start")).toBe(true);
		expect(handlers.has("session_shutdown")).toBe(true);
	});
});

describe("web-access search provider publishing", () => {
	/** A session context with just the cwd the search config reads. */
	const ctx = (cwd: string): unknown => ({ cwd });

	test("publishes the resolved provider at session start", async () => {
		const { pi } = createFakePi();
		webAccess(pi);
		const seen: unknown[] = [];
		pi.events.on(WEB_SEARCH_PROVIDER_CHANNEL, (facts: unknown) => seen.push(facts));

		for (const handler of pi.handlers.get("session_start") ?? []) await handler({}, ctx(tempDir("web-access-facts-")));

		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ provider: "duckduckgo", reason: "default", configured: true });
	});

	test("a throwing bus listener does not break the session", async () => {
		const { pi } = createFakePi();
		webAccess(pi);
		pi.events.on(WEB_SEARCH_PROVIDER_CHANNEL, () => {
			throw new Error("listener exploded");
		});

		// The listener throwing is caught inside the extension, so the session starts.
		for (const handler of pi.handlers.get("session_start") ?? []) {
			await handler({}, ctx(tempDir("web-access-facts-")));
		}
	});
});

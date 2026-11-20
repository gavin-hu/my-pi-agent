import { describe, expect, test } from "bun:test";
import codeReview from "./index.ts";
import { TOOL_NAME } from "./schema.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";

describe("the code-review extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "code-review" }, () => {
			const { pi, tools, commands } = createFakePi();
			codeReview(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
		});
	});

	test("registers code_review and /review, and nothing that runs at load", async () => {
		const { pi, tools, commands } = createFakePi();
		codeReview(pi);
		expect([...tools.keys()]).toEqual([TOOL_NAME]);
		expect([...commands.keys()]).toEqual(["review"]);
	});

	test("a session start and shutdown with no page open neither loads nor throws", async () => {
		const { pi, handlers } = createFakePi();
		codeReview(pi);
		const start = handlers.get("session_start") ?? [];
		const shutdown = handlers.get("session_shutdown") ?? [];
		expect(start.length).toBeGreaterThan(0);
		expect(shutdown.length).toBeGreaterThan(0);
		for (const handler of shutdown) await handler(undefined, undefined);
	});
});

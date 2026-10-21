/**
 * The question capability's registration and lifecycle: the tool is declared
 * model-only and inactive, then activated at `session_start` only when the
 * session can answer it.
 *
 * Tool execution lives in `tools.test.ts`; the interactive surfaces live in
 * `tui.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import question from "./index.ts";
import { TOOL_NAME } from "./tools.ts";

/** The shared context double, defaulting the mode from `hasUI`. */
function uiCtx(hasUI: boolean) {
	return fakeCtx({ mode: hasUI ? "tui" : "print", hasUI }).ctx;
}

function registered() {
	const { pi, tools, handlers } = createFakePi({ active: [] });
	question(pi);
	return { pi, tools, handlers };
}

describe("question extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "question" }, () => {
			const { tools, handlers } = registered();

			expect(tools.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers a model-only tool that starts inactive", () => {
		const { pi, tools } = registered();
		const tool = tools.get(TOOL_NAME);

		expect(tool).toBeDefined();
		expect(tool.exposure).toBe("model-only");
		expect(tool.defaultActive).toBe(false);
		expect(tool.executionMode).toBe("sequential");
		expect(tool.annotations.readOnlyHint).toBe(true);
		expect(tool.annotations.openWorldHint).toBe(false);
		expect(pi.getActiveTools()).not.toContain(TOOL_NAME);
	});

	test("activates the tool when the session has a UI", async () => {
		const { pi } = registered();
		await emit(pi, "session_start", { reason: "startup" }, uiCtx(true));

		expect(pi.getActiveTools()).toContain(TOOL_NAME);
	});

	test("leaves the tool inactive when the session has no UI", async () => {
		const { pi } = registered();
		await emit(pi, "session_start", { reason: "startup" }, uiCtx(false));

		expect(pi.getActiveTools()).not.toContain(TOOL_NAME);
	});

	test("keeps a single entry when the session starts again", async () => {
		const { pi } = registered();
		await emit(pi, "session_start", { reason: "startup" }, uiCtx(true));
		await emit(pi, "session_start", { reason: "resume" }, uiCtx(true));

		expect(pi.getActiveTools().filter((name: string) => name === TOOL_NAME)).toHaveLength(1);
	});
});

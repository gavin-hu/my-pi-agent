import { describe, expect, test } from "bun:test";
import askUserQuestion from "./index.ts";
import { TOOL_NAME } from "./tools.ts";
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";

/** A `pi` double with the requested active tools. */
function newPi(active: string[] = [TOOL_NAME]) {
	return createFakePi({ active }).pi;
}

/** The shared context double, defaulting the mode from `hasUI`. */
function uiCtx(hasUI: boolean) {
	return fakeCtx({ mode: hasUI ? "tui" : "print", hasUI }).ctx;
}

describe("ask_user_question extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "ask-user-question" }, () => {
			const { pi, tools, handlers } = createFakePi();
			askUserQuestion(pi);
			expect(tools.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers a model-only tool that starts inactive", () => {
		const pi = newPi([]);
		askUserQuestion(pi);
		const tool = pi.tools.get(TOOL_NAME);
		expect(tool).toBeDefined();
		expect(tool.exposure).toBe("model-only");
		expect(tool.defaultActive).toBe(false);
		expect(tool.executionMode).toBe("sequential");
		expect(tool.annotations.readOnlyHint).toBe(true);
	});

	test("activates the tool when the session has a UI", async () => {
		const pi = newPi([]);
		askUserQuestion(pi);
		await emit(pi, "session_start", { reason: "startup" }, uiCtx(true));
		expect(pi.getActiveTools()).toContain(TOOL_NAME);
	});

	test("leaves the tool inactive when the session has no UI", async () => {
		const pi = newPi([]);
		askUserQuestion(pi);
		await emit(pi, "session_start", { reason: "startup" }, uiCtx(false));
		expect(pi.getActiveTools()).not.toContain(TOOL_NAME);
	});

	test("degrades to an error result without a UI", async () => {
		const pi = newPi();
		askUserQuestion(pi);
		const tool = pi.tools.get(TOOL_NAME);
		const result = await tool.execute(
			"call-1",
			{ questions: [{ question: "Which one?", options: [{ label: "A" }, { label: "B" }] }] },
			undefined,
			undefined,
			uiCtx(false),
		);
		expect(result.isError).toBe(true);
		expect(result.details.unavailable).toBe(true);
		expect(result.content[0].text).toContain("No interactive UI available");
	});

	test("rejects invalid input with a thrown error", async () => {
		const pi = newPi();
		askUserQuestion(pi);
		const tool = pi.tools.get(TOOL_NAME);
		await expect(tool.execute("call-2", { questions: [] }, undefined, undefined, uiCtx(false))).rejects.toThrow(
			"At least one question",
		);
	});
});

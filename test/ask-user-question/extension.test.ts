import { describe, expect, test } from "bun:test";
import askUserQuestion from "../../extensions/ask-user-question/index.ts";
import { TOOL_NAME } from "../../extensions/ask-user-question/tools.ts";
import { createFakePi, emit } from "../helpers/fakes.ts";

function makeFakePi(activeTools: string[] = [TOOL_NAME]) {
	return createFakePi({ active: activeTools }).pi;
}

function fakeCtx(hasUI: boolean) {
	return { hasUI, mode: hasUI ? "tui" : "print" } as any;
}

describe("ask_user_question extension", () => {
	test("registers a model-only tool that starts inactive", () => {
		const pi = makeFakePi([]);
		askUserQuestion(pi);
		const tool = pi.tools.get(TOOL_NAME);
		expect(tool).toBeDefined();
		expect(tool.exposure).toBe("model-only");
		expect(tool.defaultActive).toBe(false);
		expect(tool.executionMode).toBe("sequential");
		expect(tool.annotations.readOnlyHint).toBe(true);
	});

	test("activates the tool when the session has a UI", async () => {
		const pi = makeFakePi([]);
		askUserQuestion(pi);
		await emit(pi, "session_start", { reason: "startup" }, fakeCtx(true));
		expect(pi.getActiveTools()).toContain(TOOL_NAME);
	});

	test("leaves the tool inactive when the session has no UI", async () => {
		const pi = makeFakePi([]);
		askUserQuestion(pi);
		await emit(pi, "session_start", { reason: "startup" }, fakeCtx(false));
		expect(pi.getActiveTools()).not.toContain(TOOL_NAME);
	});

	test("degrades to an error result without a UI", async () => {
		const pi = makeFakePi();
		askUserQuestion(pi);
		const tool = pi.tools.get(TOOL_NAME);
		const result = await tool.execute(
			"call-1",
			{ questions: [{ question: "Which one?", options: [{ label: "A" }, { label: "B" }] }] },
			undefined,
			undefined,
			{ hasUI: false, mode: "print" },
		);
		expect(result.isError).toBe(true);
		expect(result.details.unavailable).toBe(true);
		expect(result.content[0].text).toContain("No interactive UI available");
	});

	test("rejects invalid input with a thrown error", async () => {
		const pi = makeFakePi();
		askUserQuestion(pi);
		const tool = pi.tools.get(TOOL_NAME);
		await expect(
			tool.execute("call-2", { questions: [] }, undefined, undefined, { hasUI: false, mode: "print" }),
		).rejects.toThrow("At least one question");
	});
});

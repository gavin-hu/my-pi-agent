import { describe, expect, test } from "bun:test";
import { clarifyReply, SCOPE_QUESTION } from "../../test/helpers/fixtures/goal.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { clarifyGoalPrompt, prepareGoalPrompt } from "./clarify.ts";

const model = { id: "test-model" };

/** A model-registry double that returns `text` and records the clarifier requests. */
function registryReturning(text: string | undefined): { calls: string[]; registry: unknown } {
	const calls: string[] = [];
	return {
		calls,
		registry: {
			complete: async (_model: unknown, context: { messages: Array<{ content: Array<{ text: string }> }> }) => {
				calls.push(context.messages[0].content[0].text);
				if (text === undefined) return { stopReason: "aborted", content: [] };
				return { stopReason: "stop", content: [{ type: "text", text }] };
			},
		},
	};
}

/** A throwing registry, to prove a provider failure never escapes. */
function throwingRegistry(): unknown {
	return {
		complete: async () => {
			throw new Error("provider exploded");
		},
	};
}

/** A context with UI and a model, in RPC mode so no loader is needed. */
function clarifyCtx(
	registry: unknown,
	options: { editor?: string | undefined; model?: unknown; hasUI?: boolean; mode?: string } = {},
) {
	return fakeCtx({
		mode: options.mode ?? "rpc",
		hasUI: options.hasUI ?? true,
		editor: options.editor,
		extra: { model: "model" in options ? options.model : model, modelRegistry: registry },
	});
}

describe("clarifyGoalPrompt", () => {
	test("parses a plain-text reply as a clear goal", async () => {
		const { calls, registry } = registryReturning("```\nRefactor the parser\n```");
		const { ctx } = clarifyCtx(registry);

		expect(await clarifyGoalPrompt(ctx, "refactor the parser")).toEqual({
			clear: true,
			goal: "Refactor the parser",
			questions: [],
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("refactor the parser");
	});

	test("parses a JSON reply into a clarification with questions", async () => {
		const { ctx } = clarifyCtx(registryReturning(clarifyReply()).registry);

		expect(await clarifyGoalPrompt(ctx, "add parser tests")).toEqual({
			clear: false,
			goal: "Add parser tests",
			questions: [SCOPE_QUESTION],
		});
	});

	test("returns undefined when the provider throws", async () => {
		const { ctx } = clarifyCtx(throwingRegistry());
		expect(await clarifyGoalPrompt(ctx, "refactor the parser")).toBeUndefined();
	});

	test("returns undefined for an aborted or unusable reply", async () => {
		const aborted = clarifyCtx(registryReturning(undefined).registry);
		expect(await clarifyGoalPrompt(aborted.ctx, "refactor the parser")).toBeUndefined();

		const blank = clarifyCtx(registryReturning("   ").registry);
		expect(await clarifyGoalPrompt(blank.ctx, "refactor the parser")).toBeUndefined();
	});

	test("returns undefined without a dialog UI, and skips the model call", async () => {
		const { calls, registry } = registryReturning("Refactor the parser");
		const { ctx } = clarifyCtx(registry, { hasUI: false, mode: "print" });

		expect(await clarifyGoalPrompt(ctx, "refactor the parser")).toBeUndefined();
		expect(calls).toHaveLength(0);
	});

	test("returns undefined without a model", async () => {
		const { calls, registry } = registryReturning("Refactor the parser");
		const { ctx } = clarifyCtx(registry, { model: undefined });

		expect(await clarifyGoalPrompt(ctx, "refactor the parser")).toBeUndefined();
		expect(calls).toHaveLength(0);
	});
});

describe("prepareGoalPrompt", () => {
	test("prefills the editor with the clarification and uses the edited text", async () => {
		const { registry } = registryReturning("Refactor the parser to stream input");
		const { ctx, editorCalls } = clarifyCtx(registry, { editor: "Refactor the parser to stream input, with tests" });

		const outcome = await prepareGoalPrompt(ctx, "refactor the parser", false);

		expect(outcome).toEqual({ action: "use", text: "Refactor the parser to stream input, with tests" });
		expect(editorCalls).toHaveLength(1);
		expect(editorCalls[0].prefill).toBe("Refactor the parser to stream input");
	});

	test("delegates the questions when the clarifier is unclear and asking is available", async () => {
		const { ctx, editorCalls } = clarifyCtx(registryReturning(clarifyReply()).registry, { editor: "ignored" });

		const outcome = await prepareGoalPrompt(ctx, "add parser tests", true);

		expect(outcome).toEqual({
			action: "ask",
			original: "add parser tests",
			goal: "Add parser tests",
			questions: [SCOPE_QUESTION],
		});
		expect(editorCalls).toHaveLength(0);
	});

	test("falls back to the editor with the proposed goal when asking is unavailable", async () => {
		const { ctx, editorCalls } = clarifyCtx(registryReturning(clarifyReply()).registry, {
			editor: "Add parser tests, new parser",
		});

		const outcome = await prepareGoalPrompt(ctx, "add parser tests", false);

		expect(outcome).toEqual({ action: "use", text: "Add parser tests, new parser" });
		expect(editorCalls[0].prefill).toBe("Add parser tests");
	});

	test("prefills the editor with a clear JSON goal", async () => {
		const reply = JSON.stringify({ clear: true, goal: "Refactor the parser", questions: [] });
		const { ctx, editorCalls } = clarifyCtx(registryReturning(reply).registry, {
			editor: "Refactor the parser, with tests",
		});

		expect(await prepareGoalPrompt(ctx, "refactor the parser", true)).toEqual({
			action: "use",
			text: "Refactor the parser, with tests",
		});
		expect(editorCalls[0].prefill).toBe("Refactor the parser");
	});

	test("falls back to the typed text when the clarifier produces nothing usable", async () => {
		const { registry } = registryReturning(undefined);
		const { ctx, editorCalls } = clarifyCtx(registry, { editor: "refactor the parser" });

		const outcome = await prepareGoalPrompt(ctx, "refactor the parser", false);

		expect(outcome).toEqual({ action: "use", text: "refactor the parser" });
		expect(editorCalls[0].prefill).toBe("refactor the parser");
	});

	test("falls back to the typed text when the provider throws", async () => {
		const { ctx } = clarifyCtx(throwingRegistry(), { editor: "refactor the parser" });
		expect(await prepareGoalPrompt(ctx, "refactor the parser", false)).toEqual({
			action: "use",
			text: "refactor the parser",
		});
	});

	test("cancels when the editor is dismissed", async () => {
		const { registry } = registryReturning("Refactor the parser");
		const { ctx } = clarifyCtx(registry, { editor: undefined });
		expect(await prepareGoalPrompt(ctx, "refactor the parser", false)).toEqual({ action: "cancel" });
	});

	test("skips clarify and the editor without a dialog UI", async () => {
		const { calls, registry } = registryReturning("Refactor the parser");
		const { ctx, editorCalls } = clarifyCtx(registry, { hasUI: false, mode: "print", editor: "ignored" });

		expect(await prepareGoalPrompt(ctx, "refactor the parser", true)).toEqual({
			action: "use",
			text: "refactor the parser",
		});
		expect(calls).toHaveLength(0);
		expect(editorCalls).toHaveLength(0);
	});

	test("skips clarify and the editor without a model", async () => {
		const { calls, registry } = registryReturning("Refactor the parser");
		const { ctx, editorCalls } = clarifyCtx(registry, { model: undefined, editor: "ignored" });

		expect(await prepareGoalPrompt(ctx, "refactor the parser", true)).toEqual({
			action: "use",
			text: "refactor the parser",
		});
		expect(calls).toHaveLength(0);
		expect(editorCalls).toHaveLength(0);
	});
});

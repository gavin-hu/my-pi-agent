import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { prepareGoalPrompt, refineGoalPrompt } from "./refine.ts";

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
function refineCtx(
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

describe("refineGoalPrompt", () => {
	test("returns the parsed refinement", async () => {
		const { calls, registry } = registryReturning("```\nRefactor the parser\n```");
		const { ctx } = refineCtx(registry);

		expect(await refineGoalPrompt(ctx, "refactor the parser")).toBe("Refactor the parser");
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("refactor the parser");
	});

	test("returns undefined when the provider throws", async () => {
		const { ctx } = refineCtx(throwingRegistry());
		expect(await refineGoalPrompt(ctx, "refactor the parser")).toBeUndefined();
	});

	test("returns undefined for an aborted or unusable reply", async () => {
		const aborted = refineCtx(registryReturning(undefined).registry);
		expect(await refineGoalPrompt(aborted.ctx, "refactor the parser")).toBeUndefined();

		const blank = refineCtx(registryReturning("   ").registry);
		expect(await refineGoalPrompt(blank.ctx, "refactor the parser")).toBeUndefined();
	});

	test("returns undefined without a dialog UI, and skips the model call", async () => {
		const { calls, registry } = registryReturning("Refactor the parser");
		const { ctx } = refineCtx(registry, { hasUI: false, mode: "print" });

		expect(await refineGoalPrompt(ctx, "refactor the parser")).toBeUndefined();
		expect(calls).toHaveLength(0);
	});

	test("returns undefined without a model", async () => {
		const { calls, registry } = registryReturning("Refactor the parser");
		const { ctx } = refineCtx(registry, { model: undefined });

		expect(await refineGoalPrompt(ctx, "refactor the parser")).toBeUndefined();
		expect(calls).toHaveLength(0);
	});
});

describe("prepareGoalPrompt", () => {
	test("prefills the editor with the refinement and uses the edited text", async () => {
		const { registry } = registryReturning("Refactor the parser to stream input");
		const { ctx, editorCalls } = refineCtx(registry, { editor: "Refactor the parser to stream input, with tests" });

		const outcome = await prepareGoalPrompt(ctx, "refactor the parser");

		expect(outcome).toEqual({ action: "use", text: "Refactor the parser to stream input, with tests" });
		expect(editorCalls).toHaveLength(1);
		expect(editorCalls[0].prefill).toBe("Refactor the parser to stream input");
	});

	test("falls back to the typed text when the clarifier produces nothing usable", async () => {
		const { registry } = registryReturning(undefined);
		const { ctx, editorCalls } = refineCtx(registry, { editor: "refactor the parser" });

		const outcome = await prepareGoalPrompt(ctx, "refactor the parser");

		expect(outcome).toEqual({ action: "use", text: "refactor the parser" });
		expect(editorCalls[0].prefill).toBe("refactor the parser");
	});

	test("falls back to the typed text when the provider throws", async () => {
		const { ctx } = refineCtx(throwingRegistry(), { editor: "refactor the parser" });
		expect(await prepareGoalPrompt(ctx, "refactor the parser")).toEqual({
			action: "use",
			text: "refactor the parser",
		});
	});

	test("cancels when the editor is dismissed", async () => {
		const { registry } = registryReturning("Refactor the parser");
		const { ctx } = refineCtx(registry, { editor: undefined });
		expect(await prepareGoalPrompt(ctx, "refactor the parser")).toEqual({ action: "cancel" });
	});

	test("skips refine and the editor without a dialog UI", async () => {
		const { calls, registry } = registryReturning("Refactor the parser");
		const { ctx, editorCalls } = refineCtx(registry, { hasUI: false, mode: "print", editor: "ignored" });

		expect(await prepareGoalPrompt(ctx, "refactor the parser")).toEqual({
			action: "use",
			text: "refactor the parser",
		});
		expect(calls).toHaveLength(0);
		expect(editorCalls).toHaveLength(0);
	});

	test("skips refine and the editor without a model", async () => {
		const { calls, registry } = registryReturning("Refactor the parser");
		const { ctx, editorCalls } = refineCtx(registry, { model: undefined, editor: "ignored" });

		expect(await prepareGoalPrompt(ctx, "refactor the parser")).toEqual({
			action: "use",
			text: "refactor the parser",
		});
		expect(calls).toHaveLength(0);
		expect(editorCalls).toHaveLength(0);
	});
});

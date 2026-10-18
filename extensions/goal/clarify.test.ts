import { describe, expect, test } from "bun:test";
import { clarifyRegistry, clarifyReply, SCOPE_QUESTION } from "../../test/helpers/fixtures/goal.ts";
import { fakeCtx, type FakeCtxOptions } from "../../test/helpers/context.ts";
import { clarifyGoalPrompt, prepareGoalPrompt } from "./clarify.ts";

const model = { id: "test-model" };

/** A registry that returns one reply. */
const registryReturning = (text: string | undefined) => clarifyRegistry([text]);

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
	options: {
		editor?: string | undefined;
		select?: string | undefined;
		input?: string | undefined;
		model?: unknown;
		hasUI?: boolean;
		mode?: string;
	} = {},
) {
	return fakeCtx({
		mode: options.mode ?? "rpc",
		hasUI: options.hasUI ?? true,
		editor: options.editor,
		select: options.select,
		input: options.input,
		extra: { model: "model" in options ? options.model : model, modelRegistry: registry },
	} as FakeCtxOptions);
}

describe("clarifyGoalPrompt", () => {
	test("parses a plain-text reply as an understood goal", async () => {
		const { calls, registry } = registryReturning("```\nRefactor the parser\n```");
		const { ctx } = clarifyCtx(registry);

		expect(await clarifyGoalPrompt(ctx, "refactor the parser")).toEqual({
			understood: true,
			goal: "Refactor the parser",
			questions: [],
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("refactor the parser");
	});

	test("parses a JSON reply with questions as not understood", async () => {
		const { ctx } = clarifyCtx(registryReturning(clarifyReply()).registry);

		expect(await clarifyGoalPrompt(ctx, "add parser tests")).toEqual({
			understood: false,
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
	test("prefills the editor with an understood restatement and uses the edited text", async () => {
		const { registry } = registryReturning("Refactor the parser to stream input");
		const { ctx, editorCalls } = clarifyCtx(registry, { editor: "Refactor the parser to stream input, with tests" });

		const outcome = await prepareGoalPrompt(ctx, "refactor the parser");

		expect(outcome).toEqual({ action: "use", text: "Refactor the parser to stream input, with tests" });
		expect(editorCalls).toHaveLength(1);
		expect(editorCalls[0].prefill).toBe("Refactor the parser to stream input");
	});

	test("carries the answers into the editor under the restatement, with one model call", async () => {
		const { calls, registry } = clarifyRegistry([clarifyReply()]);
		const { ctx, editorCalls, selects, notices } = clarifyCtx(registry, {
			select: "The new one",
			editor: "Add parser tests for the new parser, in CI",
		});

		const outcome = await prepareGoalPrompt(ctx, "add parser tests");

		expect(outcome).toEqual({ action: "use", text: "Add parser tests for the new parser, in CI" });
		expect(selects).toEqual([["The new one", "The old one"]]);
		expect(calls).toHaveLength(1);
		expect(editorCalls[0].prefill).toBe(`Add parser tests\n\nAlso: ${SCOPE_QUESTION.question} → The new one`);
		expect(notices).toHaveLength(0);
	});

	test("uses a free-form input for a question without options", async () => {
		const { registry } = clarifyRegistry([clarifyReply({ questions: [{ question: "Anything to add?" }] })]);
		const { ctx, editorCalls, selects } = clarifyCtx(registry, {
			input: "the new parser",
			editor: "Ship the parser",
		});

		const outcome = await prepareGoalPrompt(ctx, "ship the parser");

		expect(outcome).toEqual({ action: "use", text: "Ship the parser" });
		expect(selects).toHaveLength(0);
		expect(editorCalls[0].prefill).toBe("Add parser tests\n\nAlso: Anything to add? → the new parser");
	});

	test("sanitizes a free-form answer before it reaches the editor", async () => {
		const { registry } = clarifyRegistry([clarifyReply({ questions: [{ question: "Anything to add?" }] })]);
		const { ctx, editorCalls } = clarifyCtx(registry, {
			input: "keep\nit\u001b[31mfast",
			editor: "Ship the parser",
		});

		await prepareGoalPrompt(ctx, "ship the parser");

		expect(editorCalls[0].prefill).toContain("Also: Anything to add? → keep it [31mfast");
		expect(editorCalls[0].prefill).not.toContain("\u001b");
	});

	test("asks no questions when the goal is already understood", async () => {
		const { registry } = registryReturning("Refactor the parser to stream input");
		const { ctx, editorCalls, selects } = clarifyCtx(registry, { editor: "Refactor the parser to stream input" });

		await prepareGoalPrompt(ctx, "refactor the parser");

		expect(selects).toHaveLength(0);
		expect(editorCalls[0].prefill).toBe("Refactor the parser to stream input");
	});

	test("cancels with a notice when a question dialog is dismissed", async () => {
		const { registry } = clarifyRegistry([clarifyReply()]);
		const { ctx, editorCalls, notices } = clarifyCtx(registry, { select: undefined, editor: "ignored" });

		expect(await prepareGoalPrompt(ctx, "add parser tests")).toEqual({ action: "cancel" });
		expect(editorCalls).toHaveLength(0);
		expect(notices.at(-1)?.message).toBe("Goal not set.");
	});

	test("cancels when the editor is dismissed", async () => {
		const { registry } = registryReturning("Refactor the parser");
		const { ctx } = clarifyCtx(registry, { editor: undefined });
		expect(await prepareGoalPrompt(ctx, "refactor the parser")).toEqual({ action: "cancel" });
	});

	test("notices and keeps the typed text when the provider throws", async () => {
		const { ctx, editorCalls, notices } = clarifyCtx(throwingRegistry(), { editor: "refactor the parser" });

		const outcome = await prepareGoalPrompt(ctx, "refactor the parser");

		expect(outcome).toEqual({ action: "use", text: "refactor the parser" });
		expect(notices.at(-1)?.message).toContain("Could not confirm the goal");
		expect(editorCalls[0].prefill).toBe("refactor the parser");
	});

	test("notices and keeps the typed text when the clarifier produces nothing usable", async () => {
		const { registry } = registryReturning(undefined);
		const { ctx, notices } = clarifyCtx(registry, { editor: "refactor the parser" });

		const outcome = await prepareGoalPrompt(ctx, "refactor the parser");

		expect(outcome).toEqual({ action: "use", text: "refactor the parser" });
		expect(notices.at(-1)?.message).toContain("Could not confirm the goal");
	});

	test("skips comprehension and the dialogs without a dialog UI", async () => {
		const { calls, registry } = registryReturning("Refactor the parser");
		const { ctx, editorCalls, selects } = clarifyCtx(registry, {
			hasUI: false,
			mode: "print",
			editor: "ignored",
			select: "ignored",
		});

		expect(await prepareGoalPrompt(ctx, "refactor the parser")).toEqual({
			action: "use",
			text: "refactor the parser",
		});
		expect(calls).toHaveLength(0);
		expect(editorCalls).toHaveLength(0);
		expect(selects).toHaveLength(0);
	});

	test("skips comprehension and the dialogs without a model", async () => {
		const { calls, registry } = registryReturning("Refactor the parser");
		const { ctx, editorCalls } = clarifyCtx(registry, { model: undefined, editor: "ignored" });

		expect(await prepareGoalPrompt(ctx, "refactor the parser")).toEqual({
			action: "use",
			text: "refactor the parser",
		});
		expect(calls).toHaveLength(0);
		expect(editorCalls).toHaveLength(0);
	});
});

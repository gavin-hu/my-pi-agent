import { describe, expect, test } from "bun:test";
import { PLAN_CONSENT, PLAN_ENTER_REQUEST, type PlanModeRequest } from "../../lib/plan-entry.ts";
import { fakeCtx, type FakeCtxOptions } from "../../test/helpers/context.ts";
import { callTool } from "../../test/helpers/tools.ts";
import { lastWidget } from "../../test/helpers/entries.ts";
import { fakeTheme, makeFakePi } from "../../test/helpers/fakes.ts";
import { clarifyRegistry, clarifyReply, SCOPE_QUESTION, todoEntry } from "../../test/helpers/fixtures/goal.ts";
import { clarifyGoalPrompt, NOTES_FENCE, prepareGoalPrompt, stripNotes } from "./clarify.ts";
import { MAX_QUESTIONS, parseClarification } from "./clarify-parse.ts";
import { buildClarifyMessages, buildClarifyUserText, CLARIFY_SYSTEM_PROMPT } from "./clarify-prompt.ts";
import { PLAN_ASK, goalPhase } from "./plan-route.ts";
import { createGoalRuntime } from "./runtime.ts";
import { MAX_OBJECTIVE } from "./schema.ts";
import { TOOL_NAME, registerTools } from "./tools.ts";
import { WIDGET_KEY } from "./tui.ts";
import type { Goal } from "./types.ts";

const theme = fakeTheme;
const model = { id: "test-model" };

const planning = (objective: string): Goal => ({ objective, status: "planning" });
const active = (objective: string): Goal => ({ objective, status: "active" });
const achieved = (objective: string): Goal => ({ objective, status: "achieved" });

/** A branch that plan mode has turned on. */
const PLANNING_ON = [{ type: "custom", customType: "plan-mode", data: { enabled: true } }];

/** A fake pi that registers `enter_plan_mode`, as the plan extension does. */
function planPi() {
	return makeFakePi({ allTools: [{ name: "enter_plan_mode" }] });
}

/** A fake pi without the plan extension, so the phase cannot be entered. */
function plainPi() {
	return makeFakePi({ allTools: [{ name: "read" }] });
}

describe("goal phase routing", () => {
	test("keeps the phase of a goal that is already pursued", async () => {
		const { pi } = planPi();
		const { ctx, confirms } = fakeCtx();

		expect(await goalPhase(pi, ctx, active("ship it"), { ask: true })).toBe("active");
		expect(await goalPhase(pi, ctx, planning("design it"), { ask: true })).toBe("planning");
		expect(confirms).toEqual([]);
	});

	test("names a draft while plan mode is already on", async () => {
		const { pi } = planPi();
		const { ctx, confirms } = fakeCtx({ branch: PLANNING_ON });

		expect(await goalPhase(pi, ctx, null, { ask: true })).toBe("planning");
		expect(confirms).toEqual([]);
	});

	test("does not ask when the command records without a run", async () => {
		const { pi } = planPi();
		const { ctx, confirms } = fakeCtx();

		expect(await goalPhase(pi, ctx, null, { ask: false })).toBe("active");
		expect(confirms).toEqual([]);
	});

	test("does not ask without a dialog UI", async () => {
		const { pi } = planPi();
		const { ctx, confirms } = fakeCtx({ mode: "print" });

		expect(await goalPhase(pi, ctx, null, { ask: true })).toBe("active");
		expect(confirms).toEqual([]);
	});

	test("does not ask when plan mode is not loaded", async () => {
		const { pi } = plainPi();
		const { ctx, confirms } = fakeCtx();

		expect(await goalPhase(pi, ctx, null, { ask: true })).toBe("active");
		expect(confirms).toEqual([]);
	});

	test("asks with the shared consent sentence and records the draft when accepted", async () => {
		const { pi } = planPi();
		const { ctx, confirms } = fakeCtx({ confirm: true });
		const requests: PlanModeRequest[] = [];
		pi.events.on(PLAN_ENTER_REQUEST, (data: unknown) => {
			requests.push(data as PlanModeRequest);
			(data as PlanModeRequest).respond(true);
		});

		expect(await goalPhase(pi, ctx, null, { ask: true })).toBe("planning");
		expect(confirms).toEqual([{ title: PLAN_ASK, message: PLAN_CONSENT }]);
		expect(requests).toHaveLength(1);
		expect(requests[0].ctx).toBe(ctx);
	});

	test("records the objective when the offer is declined, without requesting plan mode", async () => {
		const { pi } = planPi();
		const { ctx, confirms } = fakeCtx({ confirm: false });
		const requests: PlanModeRequest[] = [];
		pi.events.on(PLAN_ENTER_REQUEST, (data: unknown) => requests.push(data as PlanModeRequest));

		expect(await goalPhase(pi, ctx, null, { ask: true })).toBe("active");
		expect(confirms).toHaveLength(1);
		expect(requests).toEqual([]);
	});

	test("records the objective when the request is not answered", async () => {
		const { pi } = planPi();
		const { ctx } = fakeCtx({ confirm: true });

		expect(await goalPhase(pi, ctx, null, { ask: true })).toBe("active");
	});

	test("a new goal over an achieved one is offered the phase again", async () => {
		const { pi } = planPi();
		const { ctx, confirms } = fakeCtx({ confirm: false });

		expect(await goalPhase(pi, ctx, achieved("old goal"), { ask: true })).toBe("active");
		expect(confirms).toHaveLength(1);
	});
});

/** The goal of a plain-text reply, for the fallback tests. */
const goalOf = (raw: string | undefined): string | undefined => parseClarification(raw)?.goal;

describe("clarifier reply parsing", () => {
	test("returns a plain reply, trimmed", () => {
		expect(goalOf("  Refactor the parser  ")).toBe("Refactor the parser");
	});

	test("unwraps a fenced code block", () => {
		expect(goalOf("```\nRefactor the parser\n```")).toBe("Refactor the parser");
		expect(goalOf("```text\nRefactor the parser\n```")).toBe("Refactor the parser");
	});

	test("strips wrapping quotes and a leading Goal: label", () => {
		expect(goalOf('"Refactor the parser"')).toBe("Refactor the parser");
		expect(goalOf("\u201cRefactor the parser\u201d")).toBe("Refactor the parser");
		expect(goalOf("Goal: Refactor the parser")).toBe("Refactor the parser");
		expect(goalOf("objective - Refactor the parser")).toBe("Refactor the parser");
		expect(goalOf('"Goal: Refactor the parser"')).toBe("Refactor the parser");
	});

	test("collapses newlines and tabs to one line", () => {
		expect(goalOf("Refactor the parser\nto stream\ttabs   and  spacing")).toBe(
			"Refactor the parser to stream tabs and spacing",
		);
	});

	test("treats a restatement with incidental braces as plain text", () => {
		expect(goalOf("Refactor {the parser} to stream")).toBe("Refactor {the parser} to stream");
	});

	test("returns undefined for a missing, empty, or blank reply", () => {
		expect(parseClarification(undefined)).toBeUndefined();
		expect(parseClarification("")).toBeUndefined();
		expect(parseClarification("   \n\t ")).toBeUndefined();
		expect(parseClarification('""')).toBeUndefined();
		expect(parseClarification("   ")).toBeUndefined();
		expect(parseClarification("{ not json")).toBeUndefined();
	});

	test("rejects a reply past the objective limit and accepts one at it", () => {
		expect(parseClarification("x".repeat(MAX_OBJECTIVE + 1))).toBeUndefined();
		expect(goalOf("x".repeat(MAX_OBJECTIVE))).toHaveLength(MAX_OBJECTIVE);
	});

	test("reads an understood JSON reply, fenced or bare", () => {
		expect(
			parseClarification(JSON.stringify({ understood: true, goal: "Refactor the parser", questions: [] })),
		).toEqual({ understood: true, goal: "Refactor the parser", questions: [] });
		const fenced = `\`\`\`json\n${JSON.stringify({ understood: true, goal: "Ship it", questions: [] })}\n\`\`\``;
		expect(parseClarification(fenced)?.goal).toBe("Ship it");
	});

	test("keeps questions from a not-understood reply", () => {
		expect(parseClarification(clarifyReply())).toEqual({
			understood: false,
			goal: "Add parser tests",
			questions: [SCOPE_QUESTION],
		});
	});

	test("keeps a JSON object when trailing prose contains a brace", () => {
		const reply = `{"understood": true, "goal": "Use } carefully", "questions": []} — done }`;
		expect(parseClarification(reply)).toEqual({ understood: true, goal: "Use } carefully", questions: [] });
	});

	test("treats a plain-text reply as an understood restatement", () => {
		expect(parseClarification("```\nRefactor the parser\n```")).toEqual({
			understood: true,
			goal: "Refactor the parser",
			questions: [],
		});
	});

	test("treats not-understood with no usable question as understood", () => {
		expect(parseClarification(clarifyReply({ questions: [{ question: "" }] }))).toEqual({
			understood: true,
			goal: "Add parser tests",
			questions: [],
		});
	});

	test("sanitizes, clamps, and deduplicates questions", () => {
		const reply = JSON.stringify({
			understood: false,
			goal: "Ship it",
			questions: [
				{
					question: "First?\nsecond line",
					options: [
						{ label: "One" },
						{ label: "one" },
						{ label: "Two" },
						{ label: "Three" },
						{ label: "Four" },
						{ label: "Five" },
					],
				},
				{ question: "Second?", options: [] },
				{ question: "Third?", options: [{ label: "Only one" }] },
				{ question: "Fourth?" },
				{ question: "Fifth?" },
			],
		});
		const result = parseClarification(reply);
		if (!result) throw new Error("expected a clarification");
		expect(result.understood).toBe(false);
		expect(result.questions).toHaveLength(MAX_QUESTIONS);
		expect(result.questions[0].question).toBe("First? second line");
		expect(result.questions[0].options).toEqual([
			{ label: "One" },
			{ label: "Two" },
			{ label: "Three" },
			{ label: "Four" },
		]);
		expect(result.questions[2].options).toEqual([]);
	});
});

const partText = (message: { content: Array<{ type: string; text?: string }> }): string =>
	message.content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");

describe("clarifier prompt", () => {
	test("sends the comprehension system prompt and one user message carrying the typed goal", () => {
		const { systemPrompt, messages } = buildClarifyMessages("Refactor the parser", 1);
		expect(systemPrompt).toBe(CLARIFY_SYSTEM_PROMPT);
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe("user");
		expect(messages[0].timestamp).toBe(1);
		const text = partText(messages[0] as { content: Array<{ type: string; text?: string }> });
		expect(text).toBe(buildClarifyUserText("Refactor the parser"));
		expect(text).toContain("Refactor the parser");
	});

	test("the comprehension prompt is about understanding, with the question cap", () => {
		expect(CLARIFY_SYSTEM_PROMPT).toContain("understanding");
		expect(CLARIFY_SYSTEM_PROMPT).toContain('"understood"');
		expect(CLARIFY_SYSTEM_PROMPT).toContain(`at most ${MAX_QUESTIONS} questions`);
		expect(CLARIFY_SYSTEM_PROMPT).toContain("restates the user's intent");
	});
});

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

describe("clarify host", () => {
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

	test("returns undefined when the provider throws or the reply is unusable", async () => {
		const thrown = clarifyCtx(throwingRegistry());
		expect(await clarifyGoalPrompt(thrown.ctx, "refactor the parser")).toBeUndefined();

		const aborted = clarifyCtx(registryReturning(undefined).registry);
		expect(await clarifyGoalPrompt(aborted.ctx, "refactor the parser")).toBeUndefined();

		const blank = clarifyCtx(registryReturning("   ").registry);
		expect(await clarifyGoalPrompt(blank.ctx, "refactor the parser")).toBeUndefined();
	});

	test("skips the model call without a dialog UI or a model", async () => {
		const withoutUI = registryReturning("Refactor the parser");
		const print = clarifyCtx(withoutUI.registry, { hasUI: false, mode: "print" });
		expect(await clarifyGoalPrompt(print.ctx, "refactor the parser")).toBeUndefined();
		expect(withoutUI.calls).toHaveLength(0);

		const withoutModel = registryReturning("Refactor the parser");
		const headless = clarifyCtx(withoutModel.registry, { model: undefined });
		expect(await clarifyGoalPrompt(headless.ctx, "refactor the parser")).toBeUndefined();
		expect(withoutModel.calls).toHaveLength(0);
	});

	test("stripNotes drops the notes block but keeps a user-written Also: line", () => {
		expect(stripNotes(`Add parser tests\n\n${NOTES_FENCE}\nAlso: Which parser? → The new one`)).toBe(
			"Add parser tests",
		);
		const text = "Add parser tests\nAlso: keep the old parser working";
		expect(stripNotes(text)).toBe(text);
		expect(stripNotes("Add parser tests\nAlso: Which parser? → The new one")).toBe(
			"Add parser tests\nAlso: Which parser? → The new one",
		);
	});

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
		expect(editorCalls[0].prefill).toBe(
			`Add parser tests\n\n${NOTES_FENCE}\nAlso: ${SCOPE_QUESTION.question} → The new one`,
		);
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
		expect(editorCalls[0].prefill).toBe(`Add parser tests\n\n${NOTES_FENCE}\nAlso: Anything to add? → the new parser`);
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

	test("records the goal alone when the editor keeps the prefilled notes", async () => {
		const { registry } = clarifyRegistry([clarifyReply()]);
		const prefill = `Add parser tests\n\n${NOTES_FENCE}\nAlso: ${SCOPE_QUESTION.question} → The new one`;
		const { ctx } = clarifyCtx(registry, { select: "The new one", editor: prefill });

		expect(await prepareGoalPrompt(ctx, "add parser tests")).toEqual({ action: "use", text: "Add parser tests" });
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

	test("keeps the typed text with a notice when comprehension fails", async () => {
		const thrown = clarifyCtx(throwingRegistry(), { editor: "refactor the parser" });
		const thrownOutcome = await prepareGoalPrompt(thrown.ctx, "refactor the parser");
		expect(thrownOutcome).toEqual({ action: "use", text: "refactor the parser" });
		expect(thrown.notices.at(-1)?.message).toContain("Could not confirm the goal");
		expect(thrown.editorCalls[0].prefill).toBe("refactor the parser");

		const empty = clarifyCtx(registryReturning(undefined), { editor: "refactor the parser" });
		const emptyOutcome = await prepareGoalPrompt(empty.ctx, "refactor the parser");
		expect(emptyOutcome).toEqual({ action: "use", text: "refactor the parser" });
		expect(empty.notices.at(-1)?.message).toContain("Could not confirm the goal");
	});

	test("skips comprehension and dialogs without a dialog UI or a model", async () => {
		const withoutUI = registryReturning("Refactor the parser");
		const print = clarifyCtx(withoutUI.registry, {
			hasUI: false,
			mode: "print",
			editor: "ignored",
			select: "ignored",
		});
		expect(await prepareGoalPrompt(print.ctx, "refactor the parser")).toEqual({
			action: "use",
			text: "refactor the parser",
		});
		expect(withoutUI.calls).toHaveLength(0);
		expect(print.editorCalls).toHaveLength(0);
		expect(print.selects).toHaveLength(0);

		const withoutModel = registryReturning("Refactor the parser");
		const headless = clarifyCtx(withoutModel.registry, { model: undefined, editor: "ignored" });
		expect(await prepareGoalPrompt(headless.ctx, "refactor the parser")).toEqual({
			action: "use",
			text: "refactor the parser",
		});
		expect(withoutModel.calls).toHaveLength(0);
		expect(headless.editorCalls).toHaveLength(0);
	});
});

function setup(options: { plan?: boolean } = {}) {
	// `allTools` stands in for the plan extension's registration, which is what the
	// phase decision probes before asking the user anything.
	const { pi, tools } = makeFakePi(options.plan ? { allTools: [{ name: "enter_plan_mode" }] } : {});
	const runtime = createGoalRuntime();
	registerTools(pi, runtime);
	const tool = tools.get(TOOL_NAME);
	return { pi, tool, runtime };
}

describe("goal tool", () => {
	test("registers a sequential, non-read-only, idempotent tool", () => {
		const { tool } = setup();
		expect(tool).toBeDefined();
		expect(tool.label).toBe("Goal");
		expect(tool.executionMode).toBe("sequential");
		expect(tool.annotations.readOnlyHint).toBe(false);
		expect(tool.annotations.idempotentHint).toBe(true);
		expect(tool.promptGuidelines.length).toBeGreaterThan(0);
	});

	test("sets the goal and returns it", async () => {
		const { tool, runtime } = setup();
		const { ctx } = fakeCtx();
		const result = await callTool(tool, { objective: "Ship the parser" }, ctx);

		expect(result.isError).toBeUndefined();
		expect(result.details.action).toBe("set");
		expect(result.details.goal).toEqual({ objective: "Ship the parser", status: "active" });
		expect(result.content[0].text).toContain("Ship the parser");
		expect(runtime.getGoal()).toEqual({ objective: "Ship the parser", status: "active" });
	});

	test("declares an output schema and returns structured content", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		expect(tool.outputSchema).toBeDefined();

		const result = await callTool(tool, { objective: "Ship the parser" }, ctx);
		expect(result.structuredContent).toEqual({
			goal: { objective: "Ship the parser", status: "active" },
			action: "set",
		});
	});

	test("structured content reports a clear as a null goal", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		await callTool(tool, { objective: "Ship the parser" }, ctx);

		const result = await callTool(tool, { objective: "" }, ctx);
		expect(result.structuredContent).toEqual({ goal: null, action: "clear" });
	});

	test("structured content mirrors a rejected call's unchanged goal and error", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		await callTool(tool, { objective: "Keep me" }, ctx);

		const result = await callTool(tool, { objective: "x".repeat(MAX_OBJECTIVE + 1) }, ctx);

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toEqual({
			goal: { objective: "Keep me", status: "active" },
			action: "set",
			error: result.details.error,
		});
		// No `undefined` values leak into the JSON payload.
		expect(JSON.parse(JSON.stringify(result.structuredContent))).toEqual(result.structuredContent);
	});

	test("marks the goal achieved", async () => {
		const { tool, runtime } = setup();
		const { ctx } = fakeCtx();
		await callTool(tool, { objective: "Ship the parser" }, ctx);
		const result = await callTool(tool, { objective: "Ship the parser", status: "achieved" }, ctx);

		expect(result.details.action).toBe("achieve");
		expect(result.details.goal.status).toBe("achieved");
		expect(runtime.getGoal()).toEqual({ objective: "Ship the parser", status: "achieved" });
	});

	test("records a draft when the user accepts the plan offer", async () => {
		const { tool, pi } = setup({ plan: true });
		const { ctx, confirms } = fakeCtx({ confirm: true });
		pi.events.on(PLAN_ENTER_REQUEST, (data: unknown) => (data as PlanModeRequest).respond(true));

		const result = await callTool(tool, { objective: "Ship the parser" }, ctx);

		expect(confirms).toEqual([{ title: PLAN_ASK, message: PLAN_CONSENT }]);
		expect(result.details.goal).toEqual({ objective: "Ship the parser", status: "planning" });
		expect(result.content[0].text).toContain("Goal (planning): Ship the parser");
		expect(result.structuredContent).toEqual({
			goal: { objective: "Ship the parser", status: "planning" },
			action: "set",
		});
	});

	test("records an active goal when the plan offer is declined", async () => {
		const { tool } = setup({ plan: true });
		const { ctx } = fakeCtx({ confirm: false });

		const result = await callTool(tool, { objective: "Ship the parser" }, ctx);
		expect(result.details.goal).toEqual({ objective: "Ship the parser", status: "active" });
	});

	test("an explicit active status finalizes a draft without asking", async () => {
		const { tool, pi } = setup({ plan: true });
		const { ctx, confirms } = fakeCtx({ confirm: true });
		pi.events.on(PLAN_ENTER_REQUEST, (data: unknown) => (data as PlanModeRequest).respond(true));

		const draft = await callTool(tool, { objective: "Ship the parser" }, ctx);
		expect(draft.details.goal.status).toBe("planning");

		const result = await callTool(tool, { objective: "Ship it well", status: "active" }, ctx);
		expect(confirms).toHaveLength(1);
		expect(result.details.goal).toEqual({ objective: "Ship it well", status: "active" });
	});

	test("does not ask again when an active goal is refined", async () => {
		const { tool } = setup({ plan: true });
		const { ctx, confirms } = fakeCtx({ confirm: true });
		await callTool(tool, { objective: "Ship the parser" }, ctx);
		confirms.length = 0;

		const result = await callTool(tool, { objective: "Ship it well" }, ctx);
		expect(confirms).toEqual([]);
		expect(result.details.goal).toEqual({ objective: "Ship it well", status: "active" });
	});

	test("does not ask before marking an achieved goal", async () => {
		const { tool } = setup({ plan: true });
		const { ctx, confirms } = fakeCtx();
		await callTool(tool, { objective: "Ship the parser" }, ctx);
		confirms.length = 0;

		await callTool(tool, { objective: "Ship the parser", status: "achieved" }, ctx);
		expect(confirms).toEqual([]);
	});

	test("names the todo items still open when the goal is achieved", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx({
			branch: [
				todoEntry([
					{ content: "Close the docs", status: "completed" },
					{ content: "Ship the parser", status: "in_progress" },
				]),
			],
		});
		await callTool(tool, { objective: "Ship the parser" }, ctx);
		const result = await callTool(tool, { objective: "Ship the parser", status: "achieved" }, ctx);

		expect(result.content[0].text).toContain("1 todo item is still open");
		expect(result.structuredContent).toEqual({
			goal: { objective: "Ship the parser", status: "achieved" },
			action: "achieve",
		});
	});

	test("says nothing about the list when it is empty or the goal is only set", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx({ branch: [todoEntry([{ content: "Done", status: "completed" }])] });
		await callTool(tool, { objective: "Ship the parser" }, ctx);
		const result = await callTool(tool, { objective: "Ship the parser", status: "achieved" }, ctx);

		expect(result.content[0].text).toBe("Goal achieved: Ship the parser");
	});

	test("updates the widget on a TUI session", async () => {
		const { tool } = setup();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		await callTool(tool, { objective: "Ship the parser" }, ctx);

		expect(widgetCalls.at(-1)?.key).toBe(WIDGET_KEY);
		expect(lastWidget(widgetCalls)).toBeInstanceOf(Function);
	});

	test("clearing removes the goal and the widget", async () => {
		const { tool, runtime } = setup();
		const { ctx, widgetCalls } = fakeCtx({ mode: "tui" });
		await callTool(tool, { objective: "Ship the parser" }, ctx);
		const result = await callTool(tool, { objective: "" }, ctx);

		expect(result.details.action).toBe("clear");
		expect(result.details.goal).toBeNull();
		expect(result.content[0].text).toBe("Goal cleared.");
		expect(runtime.getGoal()).toBeNull();
		expect(lastWidget(widgetCalls)).toBeUndefined();
	});

	test("rejects an over-long objective without changing the goal", async () => {
		const { tool, runtime } = setup();
		const { ctx } = fakeCtx();
		await callTool(tool, { objective: "Keep me" }, ctx);

		const result = await callTool(tool, { objective: "x".repeat(MAX_OBJECTIVE + 1) }, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("longer than");
		expect(result.details.goal).toEqual({ objective: "Keep me", status: "active" });
		expect(runtime.getGoal()).toEqual({ objective: "Keep me", status: "active" });
	});

	test("rejects an empty achieved objective without clearing the goal", async () => {
		const { tool, runtime } = setup();
		const { ctx } = fakeCtx();
		await callTool(tool, { objective: "Keep me" }, ctx);

		const result = await callTool(tool, { objective: "", status: "achieved" }, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("resend the full objective");
		expect(result.details.action).toBe("achieve");
		expect(result.details.goal).toEqual({ objective: "Keep me", status: "active" });
		expect(runtime.getGoal()).toEqual({ objective: "Keep me", status: "active" });
	});

	test("a rejected achieve reports the attempted action", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		await callTool(tool, { objective: "Keep me" }, ctx);

		const result = await callTool(tool, { objective: "x".repeat(MAX_OBJECTIVE + 1), status: "achieved" }, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.action).toBe("achieve");
	});

	test("works without a UI context", async () => {
		const { tool, runtime } = setup();
		const result = await callTool(tool, { objective: "Headless" }, undefined);
		expect(result.isError).toBeUndefined();
		expect(runtime.getGoal()).toEqual({ objective: "Headless", status: "active" });
	});
});

describe("goal tool rendering", () => {
	const render = (component: { render(width: number): string[] }, width = 80): string =>
		component.render(width).join("\n");

	test("streaming call shows a pending label, not a clear", () => {
		const { tool } = setup();
		const text = render(tool.renderCall({}, theme, { argsComplete: false }));
		expect(text).toContain("goal → …");
		expect(text).not.toContain("clear");
	});

	test("renderResult sanitizes a rejected call's error text", () => {
		const { tool } = setup();
		const result = { content: [{ type: "text", text: "" }], details: { action: "set", error: "bad\u001b[31mtext" } };
		const text = render(
			tool.renderResult(result, { expanded: false, isPartial: false }, theme, { argsComplete: true }),
		);
		expect(text).toContain("bad");
		expect(text).not.toContain("\u001b");
	});

	test("renderResult states the status without repeating the objective", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		const result = await callTool(tool, { objective: "Ship the parser" }, ctx);
		const lines = tool
			.renderResult(result, { expanded: false, isPartial: false }, theme, { argsComplete: true })
			.render(80);
		expect(lines).toEqual(["", "Goal · active"]);
		expect(lines.join("\n")).not.toContain("Ship the parser");
	});

	test("renderResult reads as done for an achieved goal, at any expansion", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		const result = await callTool(tool, { objective: "Ship the parser", status: "achieved" }, ctx);
		const withOptions = (expanded: boolean) =>
			render(tool.renderResult(result, { expanded, isPartial: false }, theme, { argsComplete: true }), 200);
		expect(withOptions(false)).toContain("Goal · achieved");
		expect(withOptions(true)).toContain("Goal · achieved");
		expect(withOptions(true)).not.toContain("Ship the parser");
	});

	test("renders a clear with a neutral marker, not the achieved check", async () => {
		const { tool } = setup();
		const { ctx } = fakeCtx();
		await callTool(tool, { objective: "Ship the parser" }, ctx);
		const result = await callTool(tool, { objective: "" }, ctx);

		const text = render(
			tool.renderResult(result, { expanded: false, isPartial: false }, theme, { argsComplete: true }),
		);
		expect(text).toContain("Cleared the goal");
		expect(text).not.toContain("✓");
	});

	test("labels an achieve call as achieve", () => {
		const { tool } = setup();
		const text = render(
			tool.renderCall({ objective: "Ship the parser", status: "achieved" }, theme, { argsComplete: true }),
		);
		expect(text).toContain("goal → achieve:");
	});

	test("the call line names the tool exactly once", () => {
		const { tool } = setup();
		const text = render(tool.renderCall({ objective: "Ship the parser" }, theme, { argsComplete: true }));
		expect(text).toContain("goal → set: Ship the parser");
		expect(text).not.toContain("goal goal");
	});
});

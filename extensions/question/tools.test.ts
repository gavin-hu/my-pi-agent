/**
 * The question capability's data contract: parameter validation and
 * normalization, answer shaping for the model, and the tool's execution path.
 *
 * Execution is driven through the shared context double, so the no-UI, dialog,
 * cancel, and abort paths run without a terminal. The questionnaire itself and
 * the transcript renderers live in `tui.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { registeredTool } from "../../test/helpers/fixtures/question.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { remoteCtx } from "../../test/helpers/remote-ui.ts";
import {
	buildAnswer,
	collectAnswers,
	completedResult,
	describeSelection,
	formatAnswerText,
	optionSummary,
	questionHeaders,
	unavailableResult,
} from "./answers.ts";
import { MAX_OPTIONS, MAX_QUESTIONS, normalizeQuestions } from "./schema.ts";
import type { Question, Selection } from "./types.ts";

const auth: Question = {
	id: "q1",
	header: "Auth",
	question: "Which authentication?",
	options: [{ label: "OAuth" }, { label: "Cookies" }],
	allowOther: true,
	multiSelect: false,
};

const scope: Question = { ...auth, id: "q2", header: "Scope", question: "Which scopes?", multiSelect: true };

const oauth: Selection = { type: "options", values: ["OAuth"], labels: ["OAuth"], indices: [1] };

/** The registered tool, built through the extension's own registration path. */
function execute(args: unknown, ctx: unknown) {
	return registeredTool().execute("call-1", args, undefined, undefined, ctx);
}

describe("question schema", () => {
	test("applies defaults to a bare question", () => {
		expect(normalizeQuestions([{ question: "  Which one?  " }])).toEqual([
			{
				id: "q1",
				header: "Q1",
				question: "Which one?",
				options: [],
				allowOther: false,
				multiSelect: false,
			},
		]);
	});

	test("keeps options, trimmed descriptions, and flags", () => {
		const [question] = normalizeQuestions([
			{
				question: "Which database?",
				header: "DB",
				multiSelect: true,
				options: [{ label: "Postgres", description: "  Relational  " }, { label: "SQLite" }],
			},
		]);

		expect(question.header).toBe("DB");
		expect(question.multiSelect).toBe(true);
		expect(question.allowOther).toBe(true);
		expect(question.options).toEqual([{ label: "Postgres", description: "Relational" }, { label: "SQLite" }]);
	});

	test("clips a long header to the visible tab width", () => {
		const [question] = normalizeQuestions([{ question: "Q?", header: "a".repeat(40) }]);
		expect(question.header).toHaveLength(12);
	});

	test("rejects an empty call", () => {
		expect(() => normalizeQuestions([])).toThrow(/At least one question/);
		expect(() => normalizeQuestions(undefined)).toThrow(/At least one question/);
	});

	test("rejects too many questions", () => {
		const questions = Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => ({ question: `Q${i}` }));
		expect(() => normalizeQuestions(questions)).toThrow(/At most 4 questions/);
	});

	test("rejects a missing question text", () => {
		expect(() => normalizeQuestions([{ question: "   " }])).toThrow(/missing its question text/);
	});

	test("rejects options that are not an array", () => {
		expect(() => normalizeQuestions([{ question: "Q?", options: "nope" }])).toThrow(/options must be an array/);
	});

	test("rejects a single option", () => {
		expect(() => normalizeQuestions([{ question: "Q?", options: [{ label: "only" }] }])).toThrow(/at least 2 options/);
	});

	test("rejects too many options", () => {
		const options = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => ({ label: `o${i}` }));
		expect(() => normalizeQuestions([{ question: "Q?", options }])).toThrow(/at most 4 options/);
	});

	test("rejects duplicate options and blank labels", () => {
		expect(() => normalizeQuestions([{ question: "Q?", options: [{ label: "A" }, { label: "a" }] }])).toThrow(
			/duplicate option/,
		);
		expect(() => normalizeQuestions([{ question: "Q?", options: [{ label: "A" }, { label: " " }] }])).toThrow(
			/every option needs a label/,
		);
	});

	test("rejects duplicate headers", () => {
		expect(() =>
			normalizeQuestions([
				{ question: "one", header: "Same" },
				{ question: "two", header: "same" },
			]),
		).toThrow(/Duplicate header/);
	});
});

describe("answers", () => {
	test("builds an option answer with its labels and indices", () => {
		expect(buildAnswer(auth, oauth)).toEqual({
			id: "q1",
			header: "Auth",
			question: "Which authentication?",
			values: ["OAuth"],
			labels: ["OAuth"],
			wasCustom: false,
			indices: [1],
		});
	});

	test("marks a typed answer as custom", () => {
		const answer = buildAnswer(auth, { type: "custom", text: "sso" });

		expect(answer.wasCustom).toBe(true);
		expect(answer.values).toEqual(["sso"]);
	});

	test("collects answered questions in order and skips unanswered ones", () => {
		const selections = new Map<string, Selection>([["q2", { type: "custom", text: "repo" }]]);
		const answers = collectAnswers([auth, scope], selections);

		expect(answers).toHaveLength(1);
		expect(answers[0]).toMatchObject({ id: "q2", header: "Scope", wasCustom: true, values: ["repo"] });
	});

	test("formats selected answers with their numbers", () => {
		const text = formatAnswerText(completedResult([auth], new Map([["q1", oauth]])));

		expect(text).toContain("Auth:");
		expect(text).toContain("1. OAuth");
	});

	test("joins a multi-select answer", () => {
		const selection: Selection = {
			type: "options",
			values: ["repo", "read:org"],
			labels: ["repo", "read:org"],
			indices: [2, 4],
		};
		const text = formatAnswerText(completedResult([scope], new Map([["q2", selection]])));

		expect(text).toContain("Scope:");
		expect(text).toContain("2. repo");
		expect(text).toContain("4. read:org");
	});

	test("marks a written answer for the model", () => {
		const text = formatAnswerText(completedResult([auth], new Map([["q1", { type: "custom", text: "json logs" }]])));

		expect(text).toContain("Auth:");
		expect(text).toContain("user wrote");
		expect(text).toContain("json logs");
	});

	test("reports cancellation, no answer, and unavailability", () => {
		expect(formatAnswerText({ questions: [auth], answers: [], cancelled: true })).toContain("cancelled");
		expect(formatAnswerText({ questions: [auth], answers: [], cancelled: false })).toContain("No answer");
		expect(formatAnswerText(unavailableResult([auth]))).toContain("No interactive UI");
	});

	test("notes a cancel after answers were gathered", () => {
		const result = completedResult([auth], new Map([["q1", oauth]]));
		const text = formatAnswerText({ ...result, cancelled: true });

		expect(text).toContain("1. OAuth");
		expect(text).toContain("remaining questions were cancelled");
	});

	test("describes options, custom text, and a missing answer", () => {
		expect(describeSelection(oauth)).toContain("1. OAuth");
		expect(describeSelection({ type: "custom", text: "hi" })).toContain("(wrote) hi");
		expect(describeSelection(undefined)).toContain("(unanswered)");
	});

	test("reads a partial streaming call as absent instead of throwing", () => {
		expect(questionHeaders([{ header: undefined }, { header: 1 }])).toEqual(["Q1", "Q2"]);

		const partial = optionSummary([{ header: "Auth", options: [{ label: "OAuth" }, {}] }]).join(" ");
		expect(partial).toContain("OAuth");
		expect(partial).toContain("Other");
		expect(partial).not.toContain("undefined");
		expect(optionSummary([{ header: "Auth", options: [{}] }]).join(" ")).toContain("Other");
		expect(optionSummary([{ header: "Auth", options: "nope" }])).toEqual([]);
	});
});

describe("ask_user_question execution", () => {
	test("returns an error result when the session has no UI", async () => {
		const { ctx } = fakeCtx({ mode: "print", hasUI: false });
		const result = await execute(
			{ questions: [{ question: "Which one?", options: [{ label: "A" }, { label: "B" }] }] },
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(result.details.unavailable).toBe(true);
		expect(result.content[0].text).toContain("No interactive UI");
	});

	test("rejects an invalid call with the schema message", async () => {
		const { ctx } = fakeCtx({ mode: "print", hasUI: false });

		await expect(execute({ questions: [] }, ctx)).rejects.toThrow(/At least one question/);
	});

	test("answers through dialogs on a remote turn", async () => {
		const { ctx, customCalls, selects } = remoteCtx({ select: "A" });
		const result = await execute(
			{ questions: [{ question: "Which one?", options: [{ label: "A" }, { label: "B" }] }] },
			ctx,
		);

		expect(customCalls).toEqual([]);
		expect(selects).toHaveLength(1);
		expect(result.isError).toBe(false);
		expect(result.details.answers[0].values).toEqual(["A"]);
	});

	test("returns a cancelled, non-error result when a dialog is dismissed", async () => {
		const { ctx } = fakeCtx({ mode: "rpc", hasUI: true, select: undefined });
		const result = await execute(
			{ questions: [{ question: "Which one?", options: [{ label: "A" }, { label: "B" }] }] },
			ctx,
		);

		expect(result.isError).toBe(false);
		expect(result.details.cancelled).toBe(true);
		expect(result.details.answers).toEqual([]);
		expect(result.content[0].text).toContain("cancelled");
	});
});

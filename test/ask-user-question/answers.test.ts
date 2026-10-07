import { describe, expect, test } from "bun:test";
import {
	CANCELLED_TEXT,
	UNAVAILABLE_TEXT,
	buildAnswer,
	completedResult,
	describeSelection,
	formatAnswerText,
	formatCallText,
	unavailableResult,
} from "../../extensions/ask-user-question/answers.ts";
import type { Question } from "../../extensions/ask-user-question/types.ts";

const single: Question = {
	id: "q1",
	header: "Auth",
	question: "Which authentication?",
	options: [{ label: "OAuth" }, { label: "Cookies" }],
	allowOther: true,
	multiSelect: false,
};

const multi: Question = { ...single, id: "q2", header: "Scope", multiSelect: true };

describe("buildAnswer", () => {
	test("formats an option selection", () => {
		expect(buildAnswer(single, { type: "options", values: ["OAuth"], labels: ["OAuth"], indices: [1] })).toEqual({
			id: "q1",
			header: "Auth",
			question: "Which authentication?",
			values: ["OAuth"],
			labels: ["OAuth"],
			wasCustom: false,
			indices: [1],
		});
	});

	test("formats a custom answer", () => {
		expect(buildAnswer(single, { type: "custom", text: "sso" }).wasCustom).toBe(true);
	});
});

describe("formatAnswerText", () => {
	test("numbers selected options", () => {
		const result = completedResult(
			[single],
			new Map([["q1", { type: "options", values: ["OAuth"], labels: ["OAuth"], indices: [1] }]]),
		);
		expect(formatAnswerText(result)).toBe("Auth: user selected: 1. OAuth");
	});

	test("joins multi-select answers", () => {
		const result = completedResult(
			[multi],
			new Map([
				[
					"q2",
					{ type: "options", values: ["repo", "read:org"], labels: ["repo", "read:org"], indices: [2, 4] },
				],
			]),
		);
		expect(formatAnswerText(result)).toBe("Scope: user selected: 2. repo, 4. read:org");
	});

	test("marks a written answer", () => {
		const result = completedResult([single], new Map([["q1", { type: "custom", text: "json logs" }]]));
		expect(formatAnswerText(result)).toBe("Auth: user wrote: json logs");
	});

	test("handles cancel and unavailability", () => {
		expect(formatAnswerText({ questions: [single], answers: [], cancelled: true })).toBe(CANCELLED_TEXT);
		expect(formatAnswerText(unavailableResult([single]))).toBe(UNAVAILABLE_TEXT);
	});

	test("notes a cancel after partial answers", () => {
		const result = completedResult(
			[single],
			new Map([["q1", { type: "options", values: ["OAuth"], labels: ["OAuth"], indices: [1] }]]),
		);
		expect(formatAnswerText({ ...result, cancelled: true })).toBe(
			"Auth: user selected: 1. OAuth\n(the remaining questions were cancelled)",
		);
	});
});

describe("formatCallText", () => {
	test("summarizes questions and options", () => {
		expect(formatCallText([single, multi])).toBe(
			"ask_user_question 2 questions (Auth, Scope)\n  Options: Auth: OAuth, Cookies, Other · Scope: OAuth, Cookies, Other",
		);
	});

	test("omits the options line for free-form questions", () => {
		const freeForm: Question = { ...single, header: "Notes", options: [], allowOther: false };
		expect(formatCallText([freeForm])).toBe("ask_user_question 1 question (Notes)");
	});
});

describe("describeSelection", () => {
	test("describes options, custom text, and no answer", () => {
		expect(describeSelection({ type: "options", values: ["a"], labels: ["a"], indices: [1] })).toBe("1. a");
		expect(describeSelection({ type: "custom", text: "hi" })).toBe("(wrote) hi");
		expect(describeSelection(undefined)).toBe("(unanswered)");
	});
});

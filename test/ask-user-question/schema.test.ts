import { describe, expect, test } from "bun:test";
import { HEADER_MAX_WIDTH, MAX_OPTIONS, MAX_QUESTIONS, normalizeQuestions } from "../../extensions/ask-user-question/schema.ts";

describe("normalizeQuestions", () => {
	test("applies defaults", () => {
		const [question] = normalizeQuestions([{ question: "  Which one?  " }]);
		expect(question).toEqual({
			id: "q1",
			header: "Q1",
			question: "Which one?",
			options: [],
			allowOther: false,
			multiSelect: false,
		});
	});

	test("keeps options, descriptions, and flags", () => {
		const [question] = normalizeQuestions([
			{
				question: "Which database?",
				header: "DB",
				multiSelect: true,
				options: [
					{ label: "Postgres", description: "  Relational  " },
					{ label: "SQLite" },
				],
			},
		]);
		expect(question.header).toBe("DB");
		expect(question.multiSelect).toBe(true);
		expect(question.allowOther).toBe(true);
		expect(question.options).toEqual([{ label: "Postgres", description: "Relational" }, { label: "SQLite" }]);
	});

	test("truncates long headers", () => {
		const [question] = normalizeQuestions([{ question: "Q?", header: "a".repeat(40) }]);
		expect(question.header).toHaveLength(HEADER_MAX_WIDTH);
	});

	test("rejects an empty call", () => {
		expect(() => normalizeQuestions([])).toThrow("At least one question");
		expect(() => normalizeQuestions(undefined)).toThrow("At least one question");
	});

	test("rejects too many questions", () => {
		const questions = Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => ({ question: `Q${i}` }));
		expect(() => normalizeQuestions(questions)).toThrow(`At most ${MAX_QUESTIONS}`);
	});

	test("rejects a missing question text", () => {
		expect(() => normalizeQuestions([{ question: "   " }])).toThrow("missing its question text");
	});

	test("rejects a single option", () => {
		expect(() => normalizeQuestions([{ question: "Q?", options: [{ label: "only" }] }])).toThrow("at least 2 options");
	});

	test("rejects too many options", () => {
		const options = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => ({ label: `o${i}` }));
		expect(() => normalizeQuestions([{ question: "Q?", options }])).toThrow(`at most ${MAX_OPTIONS}`);
	});

	test("rejects duplicate options and blank labels", () => {
		expect(() =>
			normalizeQuestions([{ question: "Q?", options: [{ label: "A" }, { label: "a" }] }]),
		).toThrow('duplicate option "a"');
		expect(() => normalizeQuestions([{ question: "Q?", options: [{ label: "A" }, { label: " " }] }])).toThrow(
			"every option needs a label",
		);
	});

	test("rejects duplicate headers", () => {
		expect(() =>
			normalizeQuestions([
				{ question: "one", header: "Same" },
				{ question: "two", header: "same" },
			]),
		).toThrow("Duplicate header");
	});
});

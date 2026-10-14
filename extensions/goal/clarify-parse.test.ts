import { describe, expect, test } from "bun:test";
import { clarifyReply, SCOPE_QUESTION } from "../../test/helpers/fixtures/goal.ts";
import { MAX_QUESTIONS, parseClarification } from "./clarify-parse.ts";
import { MAX_OBJECTIVE } from "./schema.ts";

/** The goal of a plain-text reply, for the fallback tests. */
const goalOf = (raw: string | undefined): string | undefined => parseClarification(raw)?.goal;

describe("parseClarification plain-text fallback", () => {
	test("returns a plain reply, trimmed", () => {
		expect(goalOf("  Refactor the parser  ")).toBe("Refactor the parser");
	});

	test("unwraps a fenced code block", () => {
		expect(goalOf("```\nRefactor the parser\n```")).toBe("Refactor the parser");
		expect(goalOf("```text\nRefactor the parser\n```")).toBe("Refactor the parser");
	});

	test("strips wrapping quotes", () => {
		expect(goalOf('"Refactor the parser"')).toBe("Refactor the parser");
		expect(goalOf("\u201cRefactor the parser\u201d")).toBe("Refactor the parser");
	});

	test("drops a leading Goal: label, with or without quotes", () => {
		expect(goalOf("Goal: Refactor the parser")).toBe("Refactor the parser");
		expect(goalOf("objective - Refactor the parser")).toBe("Refactor the parser");
		expect(goalOf('"Goal: Refactor the parser"')).toBe("Refactor the parser");
	});

	test("collapses newlines and tabs to one line", () => {
		expect(goalOf("Refactor the parser\nto stream\ttabs   and  spacing")).toBe(
			"Refactor the parser to stream tabs and spacing",
		);
	});

	test("returns undefined for a missing, empty, or blank reply", () => {
		expect(parseClarification(undefined)).toBeUndefined();
		expect(parseClarification("")).toBeUndefined();
		expect(parseClarification("   \n\t ")).toBeUndefined();
		expect(parseClarification('""')).toBeUndefined();
	});

	test("returns undefined when the reply exceeds the objective limit", () => {
		expect(parseClarification("x".repeat(MAX_OBJECTIVE + 1))).toBeUndefined();
	});

	test("accepts a reply at the objective limit", () => {
		expect(goalOf("x".repeat(MAX_OBJECTIVE))).toHaveLength(MAX_OBJECTIVE);
	});
});

describe("parseClarification JSON reply", () => {
	test("reads an understood reply", () => {
		expect(
			parseClarification(JSON.stringify({ understood: true, goal: "Refactor the parser", questions: [] })),
		).toEqual({
			understood: true,
			goal: "Refactor the parser",
			questions: [],
		});
	});

	test("keeps questions from a not-understood reply", () => {
		expect(parseClarification(clarifyReply())).toEqual({
			understood: false,
			goal: "Add parser tests",
			questions: [SCOPE_QUESTION],
		});
	});

	test("unwraps a fenced JSON reply", () => {
		const reply = `\`\`\`json\n${JSON.stringify({ understood: true, goal: "Ship it", questions: [] })}\n\`\`\``;
		expect(parseClarification(reply)?.goal).toBe("Ship it");
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
					header: "A very long header indeed",
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
				{ header: "Same", question: "Second?", options: [] },
				{ header: "Same", question: "Third?", options: [{ label: "Only one" }] },
				{ question: "Fourth?" },
				{ question: "Fifth?" },
			],
		});
		const result = parseClarification(reply);
		if (!result) throw new Error("expected a clarification");
		expect(result.understood).toBe(false);
		expect(result.questions).toHaveLength(MAX_QUESTIONS);
		// Header clipped to 12 characters; question collapsed to one line.
		expect(result.questions[0].header).toBe("A very long");
		expect(result.questions[0].question).toBe("First? second line");
		// Duplicate label dropped; a fifth option dropped.
		expect(result.questions[0].options).toEqual([
			{ label: "One" },
			{ label: "Two" },
			{ label: "Three" },
			{ label: "Four" },
		]);
		// A duplicate header is renumbered, and a lone option becomes free-form.
		expect(result.questions[1].header).toBe("Same");
		expect(result.questions[2].header).toBe("Q3");
		expect(result.questions[2].options).toEqual([]);
	});

	test("renumbers a header that collides with the fallback", () => {
		const reply = clarifyReply({
			questions: [
				{ header: "Q2", question: "First?", options: [{ label: "A" }, { label: "B" }] },
				{ header: "Q2", question: "Second?", options: [{ label: "A" }, { label: "B" }] },
			],
		});
		expect(parseClarification(reply)?.questions.map((q) => q.header)).toEqual(["Q2", "Q3"]);
	});

	test("returns undefined for a missing, empty, or unparseable reply", () => {
		expect(parseClarification(undefined)).toBeUndefined();
		expect(parseClarification("")).toBeUndefined();
		expect(parseClarification("   ")).toBeUndefined();
		expect(parseClarification("{ not json")).toBeUndefined();
	});
});

import { describe, expect, test } from "bun:test";
import { buildRefineMessages, buildRefineUserText, parseRefinedGoal, REFINE_SYSTEM_PROMPT } from "./clarifier.ts";
import { MAX_OBJECTIVE } from "./schema.ts";

describe("parseRefinedGoal", () => {
	test("returns a plain reply, trimmed", () => {
		expect(parseRefinedGoal("  Refactor the parser  ")).toBe("Refactor the parser");
	});

	test("unwraps a fenced code block", () => {
		expect(parseRefinedGoal("```\nRefactor the parser\n```")).toBe("Refactor the parser");
		expect(parseRefinedGoal("```text\nRefactor the parser\n```")).toBe("Refactor the parser");
	});

	test("strips wrapping quotes", () => {
		expect(parseRefinedGoal('"Refactor the parser"')).toBe("Refactor the parser");
		expect(parseRefinedGoal("\u201cRefactor the parser\u201d")).toBe("Refactor the parser");
	});

	test("drops a leading Goal: label, with or without quotes", () => {
		expect(parseRefinedGoal("Goal: Refactor the parser")).toBe("Refactor the parser");
		expect(parseRefinedGoal("objective - Refactor the parser")).toBe("Refactor the parser");
		expect(parseRefinedGoal('"Goal: Refactor the parser"')).toBe("Refactor the parser");
	});

	test("collapses newlines and tabs to one line", () => {
		expect(parseRefinedGoal("Refactor the parser\nto stream\ttabs   and  spacing")).toBe(
			"Refactor the parser to stream tabs and spacing",
		);
	});

	test("returns undefined for a missing, empty, or blank reply", () => {
		expect(parseRefinedGoal(undefined)).toBeUndefined();
		expect(parseRefinedGoal("")).toBeUndefined();
		expect(parseRefinedGoal("   \n\t ")).toBeUndefined();
		expect(parseRefinedGoal('""')).toBeUndefined();
	});

	test("returns undefined when the reply exceeds the objective limit", () => {
		expect(parseRefinedGoal("x".repeat(MAX_OBJECTIVE + 1))).toBeUndefined();
	});

	test("accepts a reply at the objective limit", () => {
		expect(parseRefinedGoal("x".repeat(MAX_OBJECTIVE))).toHaveLength(MAX_OBJECTIVE);
	});
});

describe("buildRefineMessages", () => {
	test("sends the system prompt and one user message carrying the typed goal", () => {
		const { systemPrompt, messages } = buildRefineMessages("Refactor the parser", 1);
		expect(systemPrompt).toBe(REFINE_SYSTEM_PROMPT);
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe("user");
		expect(messages[0].timestamp).toBe(1);
		const part = messages[0].content[0] as { type: string; text: string };
		expect(part.type).toBe("text");
		expect(part.text).toContain("Refactor the parser");
		expect(part.text).toBe(buildRefineUserText("Refactor the parser"));
	});
});

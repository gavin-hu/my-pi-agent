import { describe, expect, test } from "bun:test";
import {
	buildClarifyMessages,
	buildClarifyUserText,
	buildRefineMessages,
	buildRefineUserText,
	CLARIFY_SYSTEM_PROMPT,
	REFINE_SYSTEM_PROMPT,
} from "./clarify-prompt.ts";
import { MAX_QUESTIONS } from "./clarify-parse.ts";

const partText = (message: { content: Array<{ type: string; text?: string }> }): string =>
	message.content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");

describe("buildClarifyMessages", () => {
	test("sends the comprehension system prompt and one user message carrying the typed goal", () => {
		const { systemPrompt, messages } = buildClarifyMessages("Refactor the parser", 1);
		expect(systemPrompt).toBe(CLARIFY_SYSTEM_PROMPT);
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe("user");
		expect(messages[0].timestamp).toBe(1);
		expect(partText(messages[0] as { content: Array<{ type: string; text?: string }> })).toBe(
			buildClarifyUserText("Refactor the parser"),
		);
		expect(partText(messages[0] as { content: Array<{ type: string; text?: string }> })).toContain(
			"Refactor the parser",
		);
	});

	test("the comprehension prompt is about understanding, with the question cap", () => {
		expect(CLARIFY_SYSTEM_PROMPT).toContain("understanding");
		expect(CLARIFY_SYSTEM_PROMPT).toContain('"understood"');
		expect(CLARIFY_SYSTEM_PROMPT).toContain(`at most ${MAX_QUESTIONS} questions`);
		expect(CLARIFY_SYSTEM_PROMPT).toContain("restates the user's intent");
	});
});

describe("buildRefineMessages", () => {
	const answers = [
		{ question: "Which parser?", answer: "The new one" },
		{ question: "Anything to add?", answer: "Keep it fast" },
	];

	test("sends the refine system prompt and one message with the request and answers", () => {
		const { systemPrompt, messages } = buildRefineMessages("add parser tests", "Add parser tests", answers, 2);
		expect(systemPrompt).toBe(REFINE_SYSTEM_PROMPT);
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe("user");
		expect(messages[0].timestamp).toBe(2);
		const text = partText(messages[0] as { content: Array<{ type: string; text?: string }> });
		expect(text).toContain("add parser tests");
		expect(text).toContain("First restatement: Add parser tests");
		expect(text).toContain("Which parser?");
		expect(text).toContain("The new one");
		expect(text).toContain("Keep it fast");
	});

	test("omits the first restatement when there was none", () => {
		expect(buildRefineUserText("add parser tests", "", answers)).not.toContain("First restatement");
	});

	test("the refine prompt asks only for the goal sentence", () => {
		expect(REFINE_SYSTEM_PROMPT).toContain("ONLY the goal as one sentence");
		expect(REFINE_SYSTEM_PROMPT).not.toContain("JSON");
	});
});

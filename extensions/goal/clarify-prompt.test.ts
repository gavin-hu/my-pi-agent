import { describe, expect, test } from "bun:test";
import { buildClarifyMessages, buildClarifyUserText, CLARIFY_SYSTEM_PROMPT } from "./clarify-prompt.ts";
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

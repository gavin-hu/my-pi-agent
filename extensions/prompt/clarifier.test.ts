import { describe, expect, test } from "bun:test";
import {
	buildClarifyMessages,
	buildClarifyUserText,
	buildRefinedPrompt,
	clarifySystemPrompt,
	HISTORY_CHAR_LIMIT,
	recentTurnText,
} from "./clarifier.ts";

const branch = [
	{ type: "message", message: { role: "user", content: [{ type: "text", text: "first" }] } },
	{
		type: "message",
		message: { role: "assistant", content: [{ type: "text", text: "reply" }, { type: "tool_use" }] },
	},
	{ type: "custom", customType: "goal" },
	{ type: "message", message: { role: "user", content: [{ type: "text", text: "second" }] } },
];

describe("clarifySystemPrompt", () => {
	test("states the question budget and the JSON contract", () => {
		const prompt = clarifySystemPrompt(2);
		expect(prompt).toContain("at most 2 questions");
		expect(prompt).toContain('"clear"');
		expect(prompt).toContain("ONLY a JSON object");
	});
});

describe("recentTurnText", () => {
	test("renders the most recent turns in order", () => {
		expect(recentTurnText(branch, 2)).toBe("Assistant: reply\nUser: second");
	});

	test("returns empty when disabled or nothing qualifies", () => {
		expect(recentTurnText(branch, 0)).toBe("");
		expect(recentTurnText([{ type: "custom" }], 2)).toBe("");
	});

	test("skips empty text and sanitizes the rest", () => {
		const text = recentTurnText(
			[
				{ type: "message", message: { role: "user", content: "   " } },
				{ type: "message", message: { role: "user", content: "hello\u001b there" } },
			],
			2,
		);
		expect(text).toBe("User: hello there");
	});

	test("keeps only the tail of an over-long block", () => {
		const text = recentTurnText([{ type: "message", message: { role: "user", content: "x".repeat(5000) } }], 1);
		expect(text).toHaveLength(HISTORY_CHAR_LIMIT);
	});
});

describe("buildClarifyUserText", () => {
	test("returns the bare prompt without history", () => {
		expect(buildClarifyUserText("do it", "")).toBe("do it");
	});

	test("prefixes the recent conversation when present", () => {
		expect(buildClarifyUserText("do it", "User: hi")).toBe("Recent conversation:\nUser: hi\n\nRequest: do it");
	});
});

describe("buildClarifyMessages", () => {
	test("wraps the request as one user message", () => {
		expect(buildClarifyMessages("SYS", "USER", 123)).toEqual({
			systemPrompt: "SYS",
			messages: [{ role: "user", content: [{ type: "text", text: "USER" }], timestamp: 123 }],
		});
	});
});

describe("buildRefinedPrompt", () => {
	const answers = [{ header: "Scope", question: "Which tests?", answer: "unit" }];

	test("appends the goal and the answered questions", () => {
		expect(buildRefinedPrompt("Fix it", "Make the tests pass", answers)).toBe(
			"Fix it\n\nClarified goal: Make the tests pass\n\nClarifications:\n- Scope: Which tests?\n  Answer: unit",
		);
	});

	test("omits sections that have no content", () => {
		expect(buildRefinedPrompt("Fix it", "Goal", [])).toBe("Fix it\n\nClarified goal: Goal");
		expect(buildRefinedPrompt("Fix it", "", answers)).toBe(
			"Fix it\n\nClarifications:\n- Scope: Which tests?\n  Answer: unit",
		);
		expect(buildRefinedPrompt("  Fix it  ", "", [])).toBe("Fix it");
	});
});

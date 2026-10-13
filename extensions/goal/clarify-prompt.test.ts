import { describe, expect, test } from "bun:test";
import { SCOPE_QUESTION } from "../../test/helpers/fixtures/goal.ts";
import {
	buildClarifyMessages,
	buildClarifyUserText,
	buildDelegateUserText,
	CLARIFY_SYSTEM_PROMPT,
} from "./clarify-prompt.ts";

describe("buildClarifyMessages", () => {
	test("sends the system prompt and one user message carrying the typed goal", () => {
		const { systemPrompt, messages } = buildClarifyMessages("Refactor the parser", 1);
		expect(systemPrompt).toBe(CLARIFY_SYSTEM_PROMPT);
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe("user");
		expect(messages[0].timestamp).toBe(1);
		const part = messages[0].content[0] as { type: string; text: string };
		expect(part.type).toBe("text");
		expect(part.text).toContain("Refactor the parser");
		expect(part.text).toBe(buildClarifyUserText("Refactor the parser"));
	});
});

describe("buildDelegateUserText", () => {
	test("names the question tool and carries the original goal and questions", () => {
		const text = buildDelegateUserText("add parser tests", "Add parser tests", [SCOPE_QUESTION]);
		expect(text).toContain("add parser tests");
		expect(text).toContain("ask_user_question");
		expect(text).toContain("Which parser?");
		expect(text).toContain("goal tool");
	});

	test("omits the likely goal when the clarifier gave none", () => {
		const text = buildDelegateUserText("add parser tests", "", [SCOPE_QUESTION]);
		expect(text).not.toContain("A likely goal");
	});

	test("omits options for a free-form question", () => {
		const text = buildDelegateUserText("g", "g", [{ header: "Free", question: "Anything to add?", options: [] }]);
		expect(text).toContain('"question":"Anything to add?"');
		expect(text).not.toContain('"options"');
	});

	test("defaults to starting the work", () => {
		expect(buildDelegateUserText("g", "g", [])).toContain("begin the work");
	});

	test("tells the agent not to start work for a record-only goal", () => {
		const text = buildDelegateUserText("add parser tests", "Add parser tests", [SCOPE_QUESTION], { run: false });
		expect(text).toContain("do not start the work yet");
		expect(text).not.toContain("begin the work");
	});
});

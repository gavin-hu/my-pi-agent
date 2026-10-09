import { describe, expect, test } from "bun:test";
import { INTERACTION_OTHER_LABEL, type InteractionRequest } from "../../lib/interaction.ts";
import { formatPrompt, parsePromptAnswer } from "./prompt.ts";

function request(
	partial: Partial<InteractionRequest> & Pick<InteractionRequest, "kind" | "title">,
): InteractionRequest {
	return partial;
}

describe("formatPrompt", () => {
	test("numbers select options and appends the hint", () => {
		const text = formatPrompt(request({ kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] }));
		expect(text).toContain("Pick");
		expect(text).toContain("1. A");
		expect(text).toContain("2. B");
		expect(text).toContain("3. Other (type something)");
		expect(text).toContain("取消");
	});

	test("includes the confirm body", () => {
		const text = formatPrompt(request({ kind: "confirm", title: "Sure?", message: "This deletes files." }));
		expect(text).toContain("Sure?");
		expect(text).toContain("This deletes files.");
	});

	test("editors carry the prefill", () => {
		const text = formatPrompt(request({ kind: "editor", title: "Edit", prefill: "line one" }));
		expect(text).toContain("line one");
	});
});

describe("parsePromptAnswer select", () => {
	const base = request({ kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] });

	test("maps a number to its option", () => {
		expect(parsePromptAnswer(base, "2")).toEqual({ kind: "value", value: "B" });
	});

	test("maps an exact label case-insensitively", () => {
		expect(parsePromptAnswer(base, "a")).toEqual({ kind: "value", value: "A" });
	});

	test("treats free text as the other option", () => {
		expect(parsePromptAnswer(base, "something else")).toEqual({ kind: "other", text: "something else" });
	});

	test("cancels on a cancel word", () => {
		expect(parsePromptAnswer(base, "取消")).toEqual({ kind: "cancelled" });
	});

	test("retries an out-of-range number", () => {
		expect(parsePromptAnswer(base, "9")).toEqual({ kind: "retry" });
	});

	test("retries free text when there is no other option", () => {
		const noOther = request({ kind: "select", title: "Pick", options: ["A", "B"] });
		expect(parsePromptAnswer(noOther, "huh")).toEqual({ kind: "retry" });
	});

	test("retries empty input", () => {
		expect(parsePromptAnswer(base, "  ")).toEqual({ kind: "retry" });
	});
});

describe("parsePromptAnswer confirm", () => {
	const base = request({ kind: "confirm", title: "Sure?" });

	test("accepts yes words", () => {
		expect(parsePromptAnswer(base, "是")).toEqual({ kind: "confirmed", confirmed: true });
		expect(parsePromptAnswer(base, "YES")).toEqual({ kind: "confirmed", confirmed: true });
	});

	test("accepts no words and cancel as false", () => {
		expect(parsePromptAnswer(base, "否")).toEqual({ kind: "confirmed", confirmed: false });
		expect(parsePromptAnswer(base, "取消")).toEqual({ kind: "confirmed", confirmed: false });
	});

	test("retries anything else", () => {
		expect(parsePromptAnswer(base, "maybe")).toEqual({ kind: "retry" });
	});
});

describe("parsePromptAnswer input and editor", () => {
	test("input returns the text", () => {
		expect(parsePromptAnswer(request({ kind: "input", title: "Name" }), "Ada")).toEqual({
			kind: "value",
			value: "Ada",
		});
	});

	test("input cancels on a cancel word and retries empty", () => {
		expect(parsePromptAnswer(request({ kind: "input", title: "Name" }), "取消")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(request({ kind: "input", title: "Name" }), "")).toEqual({ kind: "retry" });
	});

	test("editor returns the text and treats empty as cancelled", () => {
		const editor = request({ kind: "editor", title: "Edit" });
		expect(parsePromptAnswer(editor, "1, 3")).toEqual({ kind: "value", value: "1, 3" });
		expect(parsePromptAnswer(editor, "")).toEqual({ kind: "cancelled" });
	});

	test("strips control characters", () => {
		const parsed = parsePromptAnswer(request({ kind: "input", title: "Name" }), "A\u0007da");
		expect(parsed).toEqual({ kind: "value", value: "A da" });
	});
});

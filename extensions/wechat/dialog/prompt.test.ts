/**
 * A remote prompt's two halves: the message it renders and the reply it reads.
 *
 * Both are pure, so the cases run without a bridge. The interesting edge is that
 * the words a prompt shows and the words that dismiss it overlap — a plan
 * review's third choice is 退出 — and the list the peer was handed wins.
 */

import { describe, expect, test } from "bun:test";
import { type InteractionRequest, INTERACTION_OTHER_LABEL } from "../../../lib/interaction.ts";
import { formatPrompt, parsePromptAnswer, RETRY_NOTICE } from "./prompt.ts";

describe("formatPrompt", () => {
	function request(
		partial: Partial<InteractionRequest> & Pick<InteractionRequest, "kind" | "title">,
	): InteractionRequest {
		return partial;
	}

	test("numbers select options and appends the hint", () => {
		const text = formatPrompt(
			request({ kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] }),
			{ language: "zh" },
		);
		expect(text).toContain("Pick");
		expect(text).toContain("1. A");
		expect(text).toContain("2. B");
		expect(text).toContain("3. Other (type something)");
		expect(text).toContain("取消");
	});

	test("renders one language per peer", () => {
		const request: InteractionRequest = { kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] };
		const zh = formatPrompt(request, { language: "zh" });
		const en = formatPrompt(request, { language: "en" });
		expect(zh).toContain("回复编号");
		expect(zh).not.toContain("Reply with a number");
		expect(en).toContain("Reply with a number");
		expect(en).not.toContain("回复编号");
	});

	test("does not promise free text when the select has no Other option", () => {
		const text = formatPrompt(request({ kind: "select", title: "Plan mode", options: ["Approve", "Exit"] }), {
			language: "zh",
		});
		expect(text).not.toContain("anything else becomes");
		expect(text).toContain("回复编号或选项文字");
		expect(text).toContain("取消");
	});

	test("prepends the retry notice only when asked", () => {
		const confirm = request({ kind: "confirm", title: "Sure?" });
		expect(formatPrompt(confirm)).not.toContain("didn't recognize");
		expect(formatPrompt(confirm, { retry: true }).startsWith(RETRY_NOTICE)).toBe(true);
	});

	test("includes the confirm body and the editor's prefill", () => {
		expect(formatPrompt(request({ kind: "confirm", title: "Sure?", message: "This deletes files." }))).toContain(
			"This deletes files.",
		);
		expect(formatPrompt(request({ kind: "editor", title: "Edit", prefill: "line one" }))).toContain("line one");
	});
});

describe("parsePromptAnswer select", () => {
	const base: InteractionRequest = { kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] };

	test("maps a number to its option", () => {
		expect(parsePromptAnswer(base, "2")).toEqual({ kind: "value", value: "B" });
	});

	test("maps an exact label case-insensitively", () => {
		expect(parsePromptAnswer(base, "a")).toEqual({ kind: "value", value: "A" });
	});

	test("treats free text as the other option", () => {
		expect(parsePromptAnswer(base, "something else")).toEqual({ kind: "other", text: "something else" });
	});

	test("cancels on a cancel word the list does not carry", () => {
		expect(parsePromptAnswer(base, "取消")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(base, "退出")).toEqual({ kind: "cancelled" });
	});

	test("recognizes an exit-plan phrase as a cancel", () => {
		expect(parsePromptAnswer(base, "退出 plan 模式")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(base, "exit plan mode")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(base, "leave plan")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(base, "exit code")).toEqual({ kind: "other", text: "exit code" });
	});

	test("maps a label that is also a cancel word to its option", () => {
		// A plan review's third choice is 退出 / "Exit plan mode" in both languages, so
		// the label the prompt showed has to pick the choice the number would.
		const zh: InteractionRequest = {
			kind: "select",
			title: "审阅计划：",
			options: ["批准", "继续规划", "退出", "修改意见"],
		};
		const en: InteractionRequest = {
			kind: "select",
			title: "Review the plan:",
			options: ["Approve", "Keep planning", "Exit plan mode", "Revise"],
		};
		expect(parsePromptAnswer(zh, "退出")).toEqual({ kind: "value", value: "退出" });
		expect(parsePromptAnswer(en, "Exit plan mode")).toEqual({ kind: "value", value: "Exit plan mode" });
		expect(parsePromptAnswer(en, "exit plan mode")).toEqual({ kind: "value", value: "Exit plan mode" });
		// A word the list does not carry keeps the prompt-wide meaning.
		expect(parsePromptAnswer(en, "exit")).toEqual({ kind: "cancelled" });
	});

	test("maps another prompt's cancel-word label to its option", () => {
		// The rule is the list's, not the plan review's: a question offering 取消 and a
		// worktree offering Cancel both get the option back, which each caller reads as
		// its own choice.
		const question: InteractionRequest = {
			kind: "select",
			title: "Where?",
			options: ["Stage", "取消", INTERACTION_OTHER_LABEL],
		};
		expect(parsePromptAnswer(question, "取消")).toEqual({ kind: "value", value: "取消" });
		const worktree: InteractionRequest = {
			kind: "select",
			title: "Remove it?",
			options: ["Keep it for later", "Cancel"],
		};
		expect(parsePromptAnswer(worktree, "Cancel")).toEqual({ kind: "value", value: "Cancel" });
	});

	test("retries an out-of-range number", () => {
		expect(parsePromptAnswer(base, "9")).toEqual({ kind: "retry" });
	});

	test("retries free text when there is no other option", () => {
		const noOther: InteractionRequest = { kind: "select", title: "Pick", options: ["A", "B"] };
		expect(parsePromptAnswer(noOther, "huh")).toEqual({ kind: "retry" });
	});

	test("retries empty input", () => {
		expect(parsePromptAnswer(base, "  ")).toEqual({ kind: "retry" });
	});
});

describe("parsePromptAnswer confirm", () => {
	const base: InteractionRequest = { kind: "confirm", title: "Sure?" };

	test("accepts yes words", () => {
		expect(parsePromptAnswer(base, "是")).toEqual({ kind: "confirmed", confirmed: true });
		expect(parsePromptAnswer(base, "YES")).toEqual({ kind: "confirmed", confirmed: true });
	});

	test("accepts no words and cancel as false", () => {
		expect(parsePromptAnswer(base, "否")).toEqual({ kind: "confirmed", confirmed: false });
		expect(parsePromptAnswer(base, "取消")).toEqual({ kind: "confirmed", confirmed: false });
	});

	test("accepts the everyday Chinese answers", () => {
		expect(parsePromptAnswer(base, "确定")).toEqual({ kind: "confirmed", confirmed: true });
		expect(parsePromptAnswer(base, "行")).toEqual({ kind: "confirmed", confirmed: true });
		expect(parsePromptAnswer(base, "不是")).toEqual({ kind: "confirmed", confirmed: false });
		expect(parsePromptAnswer(base, "不行")).toEqual({ kind: "confirmed", confirmed: false });
	});

	test("retries anything else", () => {
		expect(parsePromptAnswer(base, "maybe")).toEqual({ kind: "retry" });
	});
});

describe("parsePromptAnswer input and editor", () => {
	test("input returns the text, cancels on a cancel word, and retries empty", () => {
		const input: InteractionRequest = { kind: "input", title: "Name" };
		expect(parsePromptAnswer(input, "Ada")).toEqual({ kind: "value", value: "Ada" });
		expect(parsePromptAnswer(input, "取消")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(input, "")).toEqual({ kind: "retry" });
	});

	test("editor returns the text and treats empty as cancelled", () => {
		const editor: InteractionRequest = { kind: "editor", title: "Edit" };
		expect(parsePromptAnswer(editor, "1, 3")).toEqual({ kind: "value", value: "1, 3" });
		expect(parsePromptAnswer(editor, "")).toEqual({ kind: "cancelled" });
	});

	test("strips control characters", () => {
		expect(parsePromptAnswer({ kind: "input", title: "Name" }, "A\u0007da")).toEqual({ kind: "value", value: "A da" });
	});
});

/**
 * The forwarded-dialog fallback for hosts without custom components: the batch
 * prompt, the two parsers it feeds, and the dialog driver behind a fake
 * `QuestionUI`, so no host is involved.
 */

import { describe, expect, test } from "bun:test";
import { OTHER_LABEL } from "./answers.ts";
import { askViaDialogs, batchPrompt, parseBatchAnswers, parseMultiSelect, type QuestionUI } from "./dialogs.ts";
import type { Question } from "./types.ts";

const auth: Question = {
	id: "q1",
	header: "Auth",
	question: "Which authentication?",
	options: [{ label: "OAuth" }, { label: "Cookies" }],
	allowOther: true,
	multiSelect: false,
};

const scope: Question = { ...auth, id: "q2", header: "Scope", question: "Which scopes?", multiSelect: true };

const notes: Question = {
	...auth,
	id: "q3",
	header: "Notes",
	question: "Anything else?",
	options: [],
	allowOther: false,
};

interface Script {
	select?: Array<string | undefined>;
	input?: Array<string | undefined>;
	editor?: Array<string | undefined>;
	language?: "zh" | "en";
}

/** A `QuestionUI` that answers from a script and records which dialog ran. */
function fakeUI(script: Script): { ui: QuestionUI; calls: string[] } {
	const calls: string[] = [];
	const select = [...(script.select ?? [])];
	const input = [...(script.input ?? [])];
	const editor = [...(script.editor ?? [])];
	return {
		calls,
		ui: {
			language: () => script.language ?? "en",
			select: async (title, _options, opts) => {
				calls.push(`select:${title}`);
				if (opts?.signal?.aborted) return undefined;
				return select.shift();
			},
			input: async (title) => {
				calls.push(`input:${title}`);
				return input.shift();
			},
			editor: async (title) => {
				calls.push(`editor:${title}`);
				return editor.shift();
			},
		},
	};
}
describe("parseMultiSelect", () => {
	test("parses numbers in the order they were typed", () => {
		expect(parseMultiSelect(scope, "2, 1")).toEqual({
			type: "options",
			values: ["Cookies", "OAuth"],
			labels: ["Cookies", "OAuth"],
			indices: [2, 1],
		});
	});

	test("matches labels case-insensitively and de-duplicates them", () => {
		const parsed = parseMultiSelect(scope, "oauth\noauth");

		expect(parsed).toMatchObject({ type: "options", values: ["OAuth"], indices: [1] });
	});

	test("treats mixed or unknown input as free-form text", () => {
		expect(parseMultiSelect(scope, "OAuth and something else")).toEqual({
			type: "custom",
			text: "OAuth and something else",
		});
	});

	test("returns undefined for empty input", () => {
		expect(parseMultiSelect(scope, "   ")).toBeUndefined();
	});

	test("splits a list on the fullwidth separators a Chinese IME types", () => {
		expect(parseMultiSelect(scope, "1，2")).toMatchObject({ type: "options", indices: [1, 2] });
		expect(parseMultiSelect(scope, "1、2")).toMatchObject({ type: "options", indices: [1, 2] });
	});
});

describe("parseBatchAnswers", () => {
	test("parses a batch with text and multi-select", () => {
		const parsed = parseBatchAnswers([notes, scope], "1: free text; 2: 1, 2");
		expect(parsed?.get(notes.id)).toEqual({ type: "custom", text: "free text" });
		expect(parsed?.get(scope.id)).toEqual({
			type: "options",
			values: ["OAuth", "Cookies"],
			labels: ["OAuth", "Cookies"],
			indices: [1, 2],
		});
	});

	test("accepts the fullwidth separators a Chinese reply uses", () => {
		const parsed = parseBatchAnswers([notes, scope], "1：先做 A；2：1，2");

		expect(parsed?.get(notes.id)).toEqual({ type: "custom", text: "先做 A" });
		expect(parsed?.get(scope.id)).toMatchObject({ type: "options", indices: [1, 2] });
	});

	test("keeps a fullwidth semicolon used as prose inside its answer", () => {
		const parsed = parseBatchAnswers([notes, scope], "1: 先做 A；再做 B；2: 1, 2");

		expect(parsed?.get(notes.id)).toEqual({ type: "custom", text: "先做 A；再做 B" });
		expect(parsed?.get(scope.id)).toMatchObject({ type: "options", indices: [1, 2] });
	});

	test("rejects a reply that leaves a question out", () => {
		expect(parseBatchAnswers([notes, scope], "2: 1, 2")).toBeUndefined();
	});

	test("the zh format line names a separator the parser accepts", () => {
		const format = batchPrompt([notes, scope], "zh").split("\n").at(-1) ?? "";
		const separator = format.match(/[；;]/)?.[0] ?? "?";

		expect(format).toContain("格式：");
		expect(parseBatchAnswers([notes, scope], `1: 文字${separator}2: 1, 2`)?.get(scope.id)).toMatchObject({
			type: "options",
			indices: [1, 2],
		});
	});
});

describe("askViaDialogs", () => {
	test("returns a selected option with its number", async () => {
		const { ui } = fakeUI({ select: ["Cookies"] });
		const result = await askViaDialogs(ui, [auth]);

		expect(result.cancelled).toBe(false);
		expect(result.answers).toEqual([
			{
				id: "q1",
				header: "Auth",
				question: "Which authentication?",
				values: ["Cookies"],
				labels: ["Cookies"],
				wasCustom: false,
				indices: [2],
			},
		]);
	});

	test("follows the Other entry with a text input", async () => {
		const { ui, calls } = fakeUI({ select: [OTHER_LABEL], input: ["company-sso"] });
		const result = await askViaDialogs(ui, [auth]);

		expect(result.answers[0].wasCustom).toBe(true);
		expect(result.answers[0].values).toEqual(["company-sso"]);
		expect(calls[0]?.startsWith("select:")).toBe(true);
		expect(calls[1]?.startsWith("input:")).toBe(true);
	});

	test("asks a free-form question through input", async () => {
		const { ui, calls } = fakeUI({ input: ["json for logs"] });
		const result = await askViaDialogs(ui, [notes]);

		expect(calls[0]).toContain("Anything else?");
		expect(result.answers[0].wasCustom).toBe(true);
		expect(result.answers[0].values).toEqual(["json for logs"]);
	});

	test("uses the editor for a multi-select question", async () => {
		const { ui, calls } = fakeUI({ editor: ["1, 2"] });
		const result = await askViaDialogs(ui, [scope]);

		expect(calls[0]).toContain("Which scopes?");
		expect(result.answers[0].indices).toEqual([1, 2]);
	});

	test("asks all questions in one editor reply", async () => {
		const { ui, calls } = fakeUI({ editor: ["1: 1; 2: 2"] });
		const second = { ...auth, id: "q2", header: "Second" };
		const result = await askViaDialogs(ui, [auth, second]);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("1. Which authentication?");
		expect(result.cancelled).toBe(false);
		expect(result.answers.map((answer) => answer.indices)).toEqual([[1], [2]]);
	});

	test("completes a zh reply written in the format the prompt prints", async () => {
		const { ui, calls } = fakeUI({ language: "zh", editor: ["1: 2；2: 文字"] });
		const result = await askViaDialogs(ui, [auth, notes]);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("格式：");
		expect(result.cancelled).toBe(false);
		expect(result.answers.map((answer) => answer.labels)).toEqual([["Cookies"], ["文字"]]);
	});

	test("retries once when a batch answer is malformed", async () => {
		const { ui, calls } = fakeUI({ editor: ["nope", "1: 1; 2: 2"] });
		const second = { ...auth, id: "q2", header: "Second" };
		const result = await askViaDialogs(ui, [auth, second]);

		expect(calls).toHaveLength(2);
		expect(calls[1]).toContain("Please reply again");
		expect(result.cancelled).toBe(false);
	});

	test("cancels a batch when the editor is dismissed", async () => {
		const { ui } = fakeUI({ editor: [undefined] });
		const result = await askViaDialogs(ui, [auth, { ...auth, id: "q2" }]);
		expect(result.cancelled).toBe(true);
	});

	test("names the batch format in one language", () => {
		expect(batchPrompt([auth, notes], "zh")).toContain("请一次性回答所有问题");
		expect(batchPrompt([auth, notes], "en")).toContain("Answer all questions in one message");
	});

	test("cancels when a selector is dismissed", async () => {
		const { ui } = fakeUI({ select: [undefined] });
		const result = await askViaDialogs(ui, [auth]);

		expect(result.cancelled).toBe(true);
		expect(result.answers).toEqual([]);
	});

	test("cancels when a free-form input is dismissed", async () => {
		const { ui } = fakeUI({ input: [undefined] });
		const result = await askViaDialogs(ui, [notes]);

		expect(result.cancelled).toBe(true);
		expect(result.answers).toEqual([]);
	});

	test("cancels when the Other input is dismissed", async () => {
		const { ui } = fakeUI({ select: [OTHER_LABEL], input: [undefined] });
		const result = await askViaDialogs(ui, [auth]);

		expect(result.cancelled).toBe(true);
		expect(result.answers).toEqual([]);
	});

	test("cancels when the multi-select editor is dismissed or names no option", async () => {
		const dismissed = await askViaDialogs(fakeUI({ editor: [undefined] }).ui, [scope]);
		const empty = await askViaDialogs(fakeUI({ editor: ["   "] }).ui, [scope]);

		expect(dismissed.cancelled).toBe(true);
		expect(empty.cancelled).toBe(true);
		expect(empty.answers).toEqual([]);
	});

	test("aborts a pending dialog when the signal fires", async () => {
		const controller = new AbortController();
		const ui: QuestionUI = {
			select: (_title, _options, opts) =>
				new Promise((resolve) => {
					if (opts?.signal?.aborted) return resolve(undefined);
					opts?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
				}),
			input: async () => undefined,
			editor: async () => undefined,
		};
		const pending = askViaDialogs(ui, [auth], controller.signal);
		controller.abort();

		expect((await pending).cancelled).toBe(true);
	});
});

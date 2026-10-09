import { describe, expect, test } from "bun:test";
import { OTHER_LABEL } from "./answers.ts";
import { askViaDialogs, parseMultiSelect, type QuestionUI } from "./dialogs.ts";
import type { Question } from "./types.ts";

const single: Question = {
	id: "q1",
	header: "Auth",
	question: "Which authentication?",
	options: [{ label: "OAuth" }, { label: "Cookies" }],
	allowOther: true,
	multiSelect: false,
};

const multi: Question = { ...single, id: "q2", header: "Scope", question: "Which scopes?", multiSelect: true };

const freeForm: Question = { ...single, id: "q3", header: "Notes", options: [], allowOther: false };

interface Script {
	select?: Array<string | undefined>;
	input?: Array<string | undefined>;
	editor?: Array<string | undefined>;
}

function fakeUI(script: Script): { ui: QuestionUI; calls: string[] } {
	const calls: string[] = [];
	const select = [...(script.select ?? [])];
	const input = [...(script.input ?? [])];
	const editor = [...(script.editor ?? [])];
	return {
		calls,
		ui: {
			select: async (title, options) => {
				calls.push(`select:${title}:${options.join("|")}`);
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
	test("parses numbers in order", () => {
		expect(parseMultiSelect(multi, "2, 1")).toEqual({
			type: "options",
			values: ["Cookies", "OAuth"],
			labels: ["Cookies", "OAuth"],
			indices: [2, 1],
		});
	});

	test("parses labels case-insensitively and de-duplicates", () => {
		const parsed = parseMultiSelect(multi, "oauth\noauth");
		expect(parsed?.type).toBe("options");
		if (parsed?.type !== "options") throw new Error("expected options");
		expect(parsed.values).toEqual(["OAuth"]);
	});

	test("treats mixed or unknown input as free-form text", () => {
		expect(parseMultiSelect(multi, "OAuth and something else")).toEqual({
			type: "custom",
			text: "OAuth and something else",
		});
	});

	test("returns undefined for empty input", () => {
		expect(parseMultiSelect(multi, "   ")).toBeUndefined();
	});
});

describe("askViaDialogs", () => {
	test("returns a selected option with its number", async () => {
		const { ui } = fakeUI({ select: ["Cookies"] });
		const result = await askViaDialogs(ui, [single]);
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
		const result = await askViaDialogs(ui, [single]);
		expect(result.answers[0].wasCustom).toBe(true);
		expect(result.answers[0].values).toEqual(["company-sso"]);
		expect(calls[1]).toBe("input:Which authentication?");
	});

	test("cancels when the selector is dismissed", async () => {
		const { ui } = fakeUI({ select: [undefined] });
		const result = await askViaDialogs(ui, [single]);
		expect(result.cancelled).toBe(true);
		expect(result.answers).toEqual([]);
	});

	test("asks free-form questions through input", async () => {
		const { ui, calls } = fakeUI({ input: ["json for logs"] });
		const result = await askViaDialogs(ui, [freeForm]);
		expect(calls[0]).toBe("input:Which authentication?");
		expect(result.answers[0].wasCustom).toBe(true);
	});

	test("uses the editor for multi-select", async () => {
		const { ui, calls } = fakeUI({ editor: ["1, 2"] });
		const result = await askViaDialogs(ui, [multi]);
		expect(calls[0]).toContain("editor:Which scopes?");
		expect(result.answers[0].indices).toEqual([1, 2]);
	});

	test("keeps answers gathered before a cancel", async () => {
		const { ui } = fakeUI({ select: ["OAuth", undefined] });
		const result = await askViaDialogs(ui, [single, { ...single, id: "q2", header: "Scope" }]);
		expect(result.cancelled).toBe(true);
		expect(result.answers).toHaveLength(1);
		expect(result.answers[0].header).toBe("Auth");
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
		const pending = askViaDialogs(ui, [single], controller.signal);
		controller.abort();
		const result = await pending;
		expect(result.cancelled).toBe(true);
	});
});

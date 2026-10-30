/**
 * The question capability's interactive surface: the forwarded-dialog fallback,
 * the pure questionnaire state machine, the terminal component, and the tool's
 * transcript renderers.
 *
 * The state machine is driven one key at a time; the component is captured from
 * `ctx.ui.custom` and driven through render/input, so no real terminal is
 * involved.
 */

import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { registeredTool } from "../../../test/helpers/fixtures/question.ts";
import { OTHER_LABEL } from "../answers.ts";
import { askViaDialogs, batchPrompt, parseBatchAnswers, parseMultiSelect, type QuestionUI } from "../dialogs.ts";
import { askViaTui } from "./question-screen.ts";
import {
	allAnswered,
	applyCustomText,
	currentQuestion,
	initialState,
	optionCount,
	reduce,
	type KeyAction,
	type TuiState,
} from "../tui-state.ts";
import type { Question, Selection } from "../types.ts";

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

/** One normalized question with sensible defaults. */
function question(overrides: Partial<Question> = {}): Question {
	return { ...auth, ...overrides };
}

function step(state: TuiState, action: KeyAction) {
	return reduce(state, action);
}

/** Two questions, so tab navigation is available. */
const tabs: Question[] = [question(), question({ id: "q2", header: "Scope", question: "Which scopes?" })];

describe("initialState", () => {
	test("includes the Other entry in the option count", () => {
		expect(optionCount(question())).toBe(3);
		expect(optionCount(question({ allowOther: false }))).toBe(2);
	});

	test("auto-opens the editor for a free-form question", () => {
		const state = initialState([question({ options: [], allowOther: false })]);

		expect(state.editing).toBe(true);
		expect(state.editingQuestionId).toBe("q1");
	});
});

describe("single question", () => {
	test("selecting an option submits immediately", () => {
		const { state, effect } = step(initialState([question()]), "enter");

		expect(effect).toEqual({ type: "submit" });
		expect(state.selections.q1).toEqual({ type: "options", values: ["OAuth"], labels: ["OAuth"], indices: [1] });
	});

	test("Enter on Other opens the editor and typed text submits", () => {
		let state = initialState([question()]);
		state = step(state, "down").state;
		state = step(state, "down").state;

		const opened = step(state, "enter");
		expect(opened.effect).toEqual({ type: "openEditor" });
		expect(opened.state.editing).toBe(true);

		const submitted = applyCustomText(opened.state, "  sso  ");
		expect(submitted.effect).toEqual({ type: "submit" });
		expect(submitted.state.selections.q1).toEqual({ type: "custom", text: "sso" });
	});

	test("empty text closes the editor without answering", () => {
		let state = initialState([question()]);
		state = step(state, "down").state;
		state = step(state, "down").state;
		const opened = step(state, "enter");

		const closed = applyCustomText(opened.state, "   ");
		expect(closed.effect).toEqual({ type: "closeEditor" });
		expect(closed.state.selections.q1).toBeUndefined();
	});

	test("Escape cancels", () => {
		expect(step(initialState([question()]), "escape").effect).toEqual({ type: "cancel" });
	});

	test("the cursor stays within the option list", () => {
		let state = initialState([question()]);
		state = step(state, "up").state;
		expect(state.cursor).toBe(0);

		for (let i = 0; i < 4; i++) state = step(state, "down").state;
		expect(state.cursor).toBe(2);
	});
});

describe("multi-select", () => {
	test("Space toggles options and Enter is gated until one is chosen", () => {
		const multi = question({ multiSelect: true });
		let state = initialState([multi]);

		const blocked = step(state, "enter");
		expect(blocked.effect.type).toBe("blocked");
		expect(blocked.state.selections.q1).toBeUndefined();

		state = step(state, "space").state;
		expect(state.selections.q1).toEqual({ type: "options", values: ["OAuth"], labels: ["OAuth"], indices: [1] });

		state = step(state, "down").state;
		state = step(state, "space").state;
		expect(state.selections.q1).toEqual({
			type: "options",
			values: ["OAuth", "Cookies"],
			labels: ["OAuth", "Cookies"],
			indices: [1, 2],
		});

		state = step(state, "space").state;
		expect(state.selections.q1).toEqual({ type: "options", values: ["OAuth"], labels: ["OAuth"], indices: [1] });
	});

	test("Space on Other opens the editor instead of a silent no-op", () => {
		let state = initialState([question({ multiSelect: true })]);
		state = step(state, "down").state;
		state = step(state, "down").state;

		const opened = step(state, "space");
		expect(opened.effect).toEqual({ type: "openEditor" });
		expect(opened.state.editing).toBe(true);
	});

	test("toggling every option off clears the selection", () => {
		const multi = question({ multiSelect: true });
		let state = step(initialState([multi]), "space").state;
		state = step(state, "space").state;

		expect(state.selections.q1).toBeUndefined();
	});

	test("a custom Other answer satisfies the Enter gate", () => {
		let state = initialState([question({ multiSelect: true })]);
		state = step(state, "down").state;
		state = step(state, "down").state;
		const opened = step(state, "enter");
		expect(opened.effect).toEqual({ type: "openEditor" });

		const custom = applyCustomText(opened.state, "hand-rolled");
		expect(custom.effect).toEqual({ type: "submit" });
		expect(custom.state.selections.q1).toEqual({ type: "custom", text: "hand-rolled" });

		const onOption = step(custom.state, "up").state;
		expect(step(onOption, "enter").effect).toEqual({ type: "submit" });
	});
});

describe("multiple questions", () => {
	test("Enter advances to the next tab, then the Submit tab", () => {
		let state = initialState(tabs);
		state = step(state, "enter").state;
		expect(state.tab).toBe(1);

		state = step(state, "enter").state;
		expect(state.tab).toBe(2);
		expect(currentQuestion(state)).toBeUndefined();
		expect(step(state, "enter").effect).toEqual({ type: "submit" });
	});

	test("blocks submit while a question is unanswered", () => {
		let state = initialState(tabs);
		state = step(state, "enter").state;
		state = step(state, "right").state;
		expect(state.tab).toBe(2);

		const blocked = step(state, "enter");
		expect(blocked.effect.type).toBe("blocked");
		expect(blocked.state.message).toContain("Answer every question");
	});

	test("submits once every question is answered", () => {
		let state = initialState(tabs);
		state = step(state, "enter").state;
		state = step(state, "enter").state;

		expect(allAnswered(state)).toBe(true);
		expect(step(state, "enter").effect).toEqual({ type: "submit" });
	});

	test("tabs cycle with arrows", () => {
		let state = initialState(tabs);
		state = step(state, "right").state;
		expect(state.tab).toBe(1);
		state = step(state, "right").state;
		expect(state.tab).toBe(2);
		state = step(state, "right").state;
		expect(state.tab).toBe(0);
		state = step(state, "left").state;
		expect(state.tab).toBe(2);
	});
});

describe("editing", () => {
	test("Escape closes the editor and keeps the question", () => {
		let state = initialState([question(), question({ id: "q2", header: "Scope", multiSelect: true })]);
		state = step(state, "down").state;
		state = step(state, "down").state;
		state = step(state, "enter").state;
		expect(state.editing).toBe(true);

		const closed = step(state, "escape");
		expect(closed.effect).toEqual({ type: "closeEditor" });
		expect(closed.state.editing).toBe(false);
		expect(closed.state.selections.q1).toBeUndefined();
	});
});

const withOptions: Question = {
	id: "q1",
	header: "Auth",
	question: "Which authentication should we use?",
	options: [{ label: "OAuth", description: "Provider flow" }, { label: "Cookies" }],
	allowOther: true,
	multiSelect: false,
};

const freeForm: Question = {
	id: "q1",
	header: "Notes",
	question: "Anything else?",
	options: [],
	allowOther: false,
	multiSelect: false,
};

interface TuiComponent {
	render(width: number): string[];
	handleInput(data: string): void;
	focused: boolean;
}

interface OutcomeDouble {
	type: "cancelled" | "submitted";
	selections: Map<string, Selection>;
}

/** Capture the component `ctx.ui.custom` builds so a test can drive it. */
function harness(questions: Question[], signal?: AbortSignal, rows = 24) {
	let component: TuiComponent | undefined;
	const localTui = { requestRender: () => {}, terminal: { rows, columns: 80 } };
	const ctx = {
		ui: {
			custom: (
				factory: (
					tui: typeof localTui,
					theme: typeof fakeTheme,
					keybindings: unknown,
					done: (outcome: OutcomeDouble) => void,
				) => TuiComponent,
			) =>
				new Promise<OutcomeDouble>((resolve) => {
					component = factory(localTui, fakeTheme, undefined, resolve);
				}),
		},
	};
	const result = askViaTui(ctx as unknown as ExtensionContext, questions, signal);

	const current = (): TuiComponent => {
		if (!component) throw new Error("the questionnaire component was not built");
		return component;
	};

	return {
		render: (width = 70) => current().render(width),
		input: (data: string) => current().handleInput(data),
		setRows: (value: number) => {
			localTui.terminal.rows = value;
		},
		focus: (value: boolean) => {
			current().focused = value;
		},
		result,
	};
}

describe("askViaTui render", () => {
	test("renders a question with its options and the Other entry", () => {
		const text = harness([withOptions]).render().join("\n");

		expect(text).toContain("Which authentication should we use?");
		expect(text).toContain("1. OAuth");
		expect(text).toContain("Provider flow");
		expect(text).toContain(OTHER_LABEL);
		expect(text).toContain("Enter select");
	});

	test("renders tabs and a Submit tab for multiple questions", () => {
		const second: Question = { ...withOptions, id: "q2", header: "Scope", question: "Which scopes?" };
		const text = harness([withOptions, second]).render().join("\n");

		expect(text).toContain("Auth");
		expect(text).toContain("Scope");
		expect(text).toContain("Submit");
	});

	test("strips control characters from model-authored text", () => {
		const evil: Question = {
			id: "q1",
			header: "Auth\u001b[31m",
			question: "Pick\u0007 one\u001b]0;pwned\u0007",
			options: [{ label: "OAuth\u001b[0m", description: "flow\u0007" }],
			allowOther: true,
			multiSelect: false,
		};
		const second: Question = { ...evil, id: "q2", header: "Scope\u001b[0m" };
		const text = harness([evil, second]).render().join("\n");

		expect(text).toContain("OAuth");
		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("\u0007");
	});

	test("opens the editor for a free-form question", () => {
		const text = harness([freeForm]).render().join("\n");

		expect(text).toContain("Anything else?");
		expect(text).toContain("Your answer:");
		expect(text).toContain("Enter to submit");
		expect(text).not.toContain(OTHER_LABEL);
	});

	test("shows a toggled multi-select option as selected", () => {
		const h = harness([{ ...withOptions, multiSelect: true }]);
		h.input(" ");

		const text = h.render().join("\n");
		expect(text).toContain("OAuth");
		expect(text).toContain("Selected: OAuth");
	});

	test("re-wraps when the width changes instead of serving stale lines", () => {
		const h = harness([withOptions]);

		const narrow = h.render(24);
		expect(narrow.every((line) => visibleWidth(line) <= 24)).toBe(true);

		const wide = h.render(80);
		expect(wide).not.toEqual(narrow);
		expect(wide.every((line) => visibleWidth(line) <= 80)).toBe(true);
		expect(wide.join("\n")).toContain("Which authentication should we use?");
		expect(wide.join("\n")).toContain("Provider flow");
	});

	test("never splits a tab and keeps the Submit label whole", () => {
		const headers = ["FirstHeader", "SecondHeader", "ThirdHeader", "FourthHeader"];
		const questions = headers.map((header, i) => ({ ...withOptions, id: `q${i + 1}`, header }));
		for (const width of [80, 44, 32, 20]) {
			const lines = harness(questions).render(width);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			expect(lines.some((line) => line.includes("Submit"))).toBe(true);
			for (const header of headers) {
				expect(lines.filter((line) => line.includes(header))).toHaveLength(1);
			}
		}
	});

	test("propagates focus to the inline editor so it emits the cursor marker", () => {
		const h = harness([withOptions]);
		h.input("\x1b[B");
		h.input("\x1b[B");
		h.input("\r");

		h.focus(false);
		expect(h.render().join("\n")).not.toContain(CURSOR_MARKER);

		h.focus(true);
		expect(h.render().join("\n")).toContain(CURSOR_MARKER);
	});

	test("emits no cursor marker while not editing even when focused", () => {
		const h = harness([withOptions]);
		h.focus(true);

		expect(h.render().join("\n")).not.toContain(CURSOR_MARKER);
	});

	test("keeps answers gathered before a cancel", async () => {
		const second: Question = { ...withOptions, id: "q2", header: "Scope", question: "Which scopes?" };
		const h = harness([withOptions, second]);
		h.input("\r");
		h.input("\x1b");

		const result = await h.result;
		expect(result.cancelled).toBe(true);
		expect(result.answers).toHaveLength(1);
		expect(result.answers[0].header).toBe("Auth");
		expect(result.answers[0].values).toEqual(["OAuth"]);
	});

	test("shows a custom multi-select Other answer as selected", () => {
		const multi: Question = { ...withOptions, id: "q1", header: "Auth", multiSelect: true };
		const second: Question = { ...withOptions, id: "q2", header: "Scope", question: "Which scopes?" };
		const h = harness([multi, second]);
		h.input("\x1b[B");
		h.input("\x1b[B");
		h.input("\r");
		h.input("hand-rolled");
		h.input("\r");
		h.input("\x1b[D");

		const text = h.render().join("\n");
		expect(text).toContain("Selected: hand-rolled");
	});
});

describe("askViaTui wiring", () => {
	test("Enter on an option resolves with the selection", async () => {
		const h = harness([withOptions]);
		h.input("\r");

		const result = await h.result;
		expect(result.cancelled).toBe(false);
		expect(result.answers[0].values).toEqual(["OAuth"]);
		expect(result.answers[0].indices).toEqual([1]);
	});

	test("Escape resolves as cancelled", async () => {
		const h = harness([withOptions]);
		h.input("\x1b");

		expect((await h.result).cancelled).toBe(true);
	});

	test("an aborted signal resolves as cancelled", async () => {
		const controller = new AbortController();
		const h = harness([withOptions], controller.signal);
		controller.abort();

		expect((await h.result).cancelled).toBe(true);
	});

	test("clears the editor when a later question reopens it", async () => {
		const second: Question = { ...freeForm, id: "q2", header: "Notes", question: "Anything else?" };
		const h = harness([withOptions, second]);

		h.input("\x1b[B");
		h.input("\x1b[B");
		h.input("\r");
		h.input("leftover answer");
		h.input("\x1b");

		h.input("\x1b[A");
		h.input("\x1b[A");
		h.input("\r");

		const text = h.render().join("\n");
		expect(text).toContain("Anything else?");
		expect(text).not.toContain("leftover answer");
	});
});

describe("askViaTui viewport", () => {
	test("windows the options and keeps the hint and the closing rule on a short terminal", () => {
		const h = harness([withOptions], undefined, 8);
		const lines = h.render();
		const text = lines.join("\n");

		expect(text).toMatch(/option\s+1.*of 3/);
		expect(text).toContain("Esc cancel");
		expect(lines.at(-1)).toContain("─");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(70);
	});

	test("keeps the focused option visible when the window scrolls", () => {
		const h = harness([withOptions], undefined, 9);
		expect(h.render().join("\n")).toMatch(/option\s+1.*of 3/);

		h.input("\x1b[B");
		h.input("\x1b[B");
		expect(h.render().join("\n")).toContain(OTHER_LABEL);
	});

	test("picks up a height change, not only a width change", () => {
		const h = harness([withOptions], undefined, 24);
		expect(h.render().join("\n")).not.toMatch(/option\s+\d+.*of 3/);

		h.setRows(8);
		expect(h.render().join("\n")).toMatch(/option\s+1.*of 3/);
	});
});

/** The registered tool whose transcript renderers these tests exercise. */
describe("ask_user_question transcript rendering", () => {
	test("the call line lists one options line per question", () => {
		const lines = registeredTool()
			.renderCall(
				{
					questions: [
						{ question: "Auth?", header: "Auth", options: [{ label: "OAuth" }, { label: "Cookies" }] },
						{ question: "Scope?", header: "Scope", options: [{ label: "repo" }, { label: "org" }] },
					],
				},
				fakeTheme,
				{ lastComponent: undefined },
			)
			.render(80)
			.map((line: string) => line.trimEnd());

		expect(lines[0]).toContain("2 questions");
		expect(lines[0]).toContain("Auth");
		expect(lines[0]).toContain("Scope");
		expect(lines[1]).toContain("Auth:");
		expect(lines[1]).toContain("OAuth");
		expect(lines[1]).toContain("Other");
		expect(lines[2]).toContain("Scope:");
		expect(lines[2]).toContain("repo");
	});

	test("colours the option lines with the body colour, not the faintest", () => {
		const lines = registeredTool()
			.renderCall(
				{ questions: [{ question: "Auth?", header: "Auth", options: [{ label: "OAuth" }] }] },
				coloringTheme,
				{ lastComponent: undefined },
			)
			.render(80);

		expect(lines.find((line: string) => line.includes("Auth:"))).toContain("[muted]");
	});

	test("a free-form question adds no options line", () => {
		const lines = registeredTool()
			.renderCall({ questions: [{ question: "Notes?", header: "Notes" }] }, fakeTheme, {
				lastComponent: undefined,
			})
			.render(80);

		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("1 question");
	});

	test("survives a partially-streamed call", () => {
		const partials: unknown[] = [
			undefined,
			{},
			{ questions: [] },
			{ questions: "nope" },
			{ questions: [{ header: "Auth", options: [{}] }] },
			{ questions: [{ header: 1, options: [{ label: null }] }] },
		];

		for (const args of partials) {
			expect(() => registeredTool().renderCall(args, fakeTheme, { lastComponent: undefined }).render(80)).not.toThrow();
		}
	});

	test("reads a not-yet-streamed option as Other only", () => {
		const lines = registeredTool()
			.renderCall({ questions: [{ header: "Auth", options: [{}] }] }, fakeTheme, { lastComponent: undefined })
			.render(80)
			.map((line: string) => line.trimEnd());

		expect(lines[1]).toContain("Other");
		expect(lines[1]).not.toContain("undefined");
	});

	test("result renders selected and custom answers", () => {
		const details = {
			questions: [],
			answers: [
				{
					id: "1",
					header: "Auth",
					question: "Auth?",
					values: ["OAuth"],
					labels: ["OAuth"],
					wasCustom: false,
					indices: [1],
				},
				{ id: "2", header: "Format", question: "Format?", values: ["json"], labels: ["json"], wasCustom: true },
			],
			cancelled: false,
		};
		const text = registeredTool()
			.renderResult({ details, content: [{ type: "text", text: "" }] }, { expanded: false }, fakeTheme, {
				lastComponent: undefined,
			})
			.render(80)
			.join("\n");

		expect(text).toContain("Auth");
		expect(text).toContain("1. OAuth");
		expect(text).toContain("Format");
		expect(text).toContain("(wrote)");
		expect(text).toContain("json");
	});

	test("separates a multi-line answer body with a blank line", () => {
		const details = {
			questions: [],
			answers: [
				{
					id: "1",
					header: "Auth",
					question: "?",
					values: ["OAuth"],
					labels: ["OAuth"],
					wasCustom: false,
					indices: [1],
				},
				{ id: "2", header: "Scope", question: "?", values: ["repo"], labels: ["repo"], wasCustom: false, indices: [2] },
			],
			cancelled: false,
		};
		const lines = registeredTool()
			.renderResult({ details, content: [{ type: "text", text: "" }] }, { expanded: false }, fakeTheme, {
				lastComponent: undefined,
			})
			.render(80)
			.map((line: string) => line.trimEnd());

		expect(lines[0]).toBe("");
		expect(lines.join("\n")).toContain("Auth");
		expect(lines.join("\n")).toContain("Scope");
	});

	test("renders cancelled and no-UI results", () => {
		const cancelled = registeredTool()
			.renderResult(
				{ details: { questions: [], answers: [], cancelled: true }, content: [{ type: "text", text: "" }] },
				{ expanded: false },
				fakeTheme,
				{ lastComponent: undefined },
			)
			.render(80)
			.join("\n");
		expect(cancelled).toContain("Cancelled");

		const unavailable = registeredTool()
			.renderResult(
				{
					details: { questions: [], answers: [], cancelled: false, unavailable: true },
					content: [{ type: "text", text: "" }],
				},
				{ expanded: false },
				fakeTheme,
				{ lastComponent: undefined },
			)
			.render(80)
			.join("\n");
		expect(unavailable).toContain("No interactive UI");
	});
});

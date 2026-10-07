import { describe, expect, test } from "bun:test";
import { askViaTui } from "../../extensions/ask-user-question/tui.ts";
import type { Question } from "../../extensions/ask-user-question/types.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as any;

const tui = { requestRender: () => {}, terminal: { rows: 24, columns: 80 } } as any;

/** Capture the component `ctx.ui.custom` builds so a test can drive it. */
function harness(questions: Question[], signal?: AbortSignal) {
	let component: any;
	const ctx: any = {
		ui: {
			custom: (factory: any) =>
				new Promise((resolve) => {
					component = factory(tui, theme, undefined, resolve);
				}),
		},
	};
	const promise = askViaTui(ctx, questions, signal);
	return {
		render: (width = 70) => component.render(width) as string[],
		input: (data: string) => component.handleInput(data),
		result: promise,
	};
}

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

describe("askViaTui render", () => {
	test("renders a question with options and the Other entry", () => {
		const text = harness([withOptions]).render().join("\n");
		expect(text).toContain("Which authentication should we use?");
		expect(text).toContain("> 1. OAuth");
		expect(text).toContain("Provider flow");
		expect(text).toContain("Other (type something)");
		expect(text).toContain("Enter select");
	});

	test("renders tabs and a Submit tab for multiple questions", () => {
		const second: Question = { ...withOptions, id: "q2", header: "Scope", question: "Which scopes?" };
		const text = harness([withOptions, second]).render().join("\n");
		expect(text).toContain("□ Auth");
		expect(text).toContain("□ Scope");
		expect(text).toContain("✓ Submit");
	});

	test("opens the editor for a free-form question", () => {
		const text = harness([freeForm]).render().join("\n");
		expect(text).toContain("Anything else?");
		expect(text).toContain("Your answer:");
		expect(text).toContain("Enter to submit");
		expect(text).not.toContain("Other (type something)");
	});

	test("highlights a toggled multi-select option", () => {
		const multi: Question = { ...withOptions, multiSelect: true };
		const h = harness([multi]);
		h.input(" "); // toggle the first option
		const text = h.render().join("\n");
		expect(text).toContain("[x] OAuth");
		expect(text).toContain("Selected: OAuth");
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
		const result = await h.result;
		expect(result.cancelled).toBe(true);
	});

	test("an aborted signal resolves as cancelled", async () => {
		const controller = new AbortController();
		const h = harness([withOptions], controller.signal);
		controller.abort();
		const result = await h.result;
		expect(result.cancelled).toBe(true);
	});

	test("clears the editor when a later question reopens it", async () => {
		const q2: Question = { ...freeForm, id: "q2", header: "Notes", question: "Anything else?" };
		const h = harness([withOptions, q2]);

		// Q1: open "Other", type an answer, then leave via Escape (no submit).
		h.input("\x1b[B"); // down to option 2
		h.input("\x1b[B"); // down to "Other"
		h.input("\r"); // open the editor
		h.input("leftover answer");
		h.input("\x1b"); // close the editor; the component keeps the text in the Editor

		// Pick a real option so the flow advances to the free-form Q2.
		h.input("\x1b[A"); // back to option 2
		h.input("\x1b[A"); // back to option 1
		h.input("\r");

		// Q2 is free-form and opens the editor: it must not carry Q1's text.
		const text = h.render().join("\n");
		expect(text).toContain("Anything else?");
		expect(text).not.toContain("leftover answer");
	});
});

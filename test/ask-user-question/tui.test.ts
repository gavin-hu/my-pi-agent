import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
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

	test("re-wraps when the width changes instead of serving stale lines", () => {
		const h = harness([withOptions]);

		const narrow = h.render(24);
		expect(narrow.every((line) => visibleWidth(line) <= 24)).toBe(true);

		// Rendering wider must recompute the wrap, not return the 24-col cache.
		const wide = h.render(80);
		expect(wide).not.toEqual(narrow);
		expect(wide.every((line) => visibleWidth(line) <= 80)).toBe(true);
		expect(wide.join("\n")).toContain("Which authentication should we use?");
		expect(wide.join("\n")).toContain("Provider flow");
	});

	test("never splits a tab and keeps the submit arrow with its label", () => {
		const headers = ["FirstHeader", "SecondHeader", "ThirdHeader", "FourthHeader"];
		const questions = headers.map((header, i) => ({ ...withOptions, id: `q${i + 1}`, header }));
		for (const width of [80, 44, 32, 20]) {
			const lines = harness(questions).render(width);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			const submitLine = lines.find((line) => line.includes("Submit"));
			expect(submitLine).toBeDefined();
			expect(submitLine).toContain("→");
			// A tab must not be broken across two lines: each header appears exactly once.
			for (const header of headers) {
				expect(lines.filter((line) => line.includes(header))).toHaveLength(1);
			}
		}
	});

	test("keeps answers gathered before a cancel", async () => {
		const second: Question = { ...withOptions, id: "q2", header: "Scope", question: "Which scopes?" };
		const h = harness([withOptions, second]);
		h.input("\r"); // answer Auth and advance to Scope
		h.input("\x1b"); // cancel on Scope
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
		h.input("\x1b[B"); // down to option 2
		h.input("\x1b[B"); // down to Other
		h.input("\r"); // open the editor
		h.input("hand-rolled");
		h.input("\r"); // commit custom text and advance to Scope
		h.input("\x1b[D"); // back to Auth

		const text = h.render().join("\n");
		expect(text).toContain("[x] Other (type something)");
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

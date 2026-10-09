import { describe, expect, test } from "bun:test";
import {
	allAnswered,
	applyCustomText,
	currentQuestion,
	initialState,
	optionCount,
	reduce,
	type TuiState,
} from "./tui-state.ts";
import type { Question } from "./types.ts";

function question(overrides: Partial<Question> = {}): Question {
	return {
		id: "q1",
		header: "Auth",
		question: "Which authentication?",
		options: [{ label: "OAuth" }, { label: "Cookies" }],
		allowOther: true,
		multiSelect: false,
		...overrides,
	};
}

function step(state: TuiState, action: Parameters<typeof reduce>[1]) {
	return reduce(state, action);
}

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
		const opened = step(step(step(initialState([question()]), "down").state, "down").state, "enter");
		const closed = applyCustomText(opened.state, "   ");
		expect(closed.effect).toEqual({ type: "closeEditor" });
		expect(closed.state.selections.q1).toBeUndefined();
	});

	test("Escape cancels", () => {
		expect(step(initialState([question()]), "escape").effect).toEqual({ type: "cancel" });
	});

	test("the cursor stays within bounds", () => {
		let state = initialState([question()]);
		state = step(state, "up").state;
		expect(state.cursor).toBe(0);
		state = step(step(step(step(state, "down").state, "down").state, "down").state, "down").state;
		expect(state.cursor).toBe(2);
	});
});

describe("multi-select", () => {
	test("Space toggles and Enter is gated", () => {
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

		state = step(state, "space").state; // toggle Cookies back off
		expect(state.selections.q1).toEqual({ type: "options", values: ["OAuth"], labels: ["OAuth"], indices: [1] });
	});

	test("toggling every option off clears the selection", () => {
		const multi = question({ multiSelect: true });
		let state = step(initialState([multi]), "space").state;
		state = step(state, "space").state;
		expect(state.selections.q1).toBeUndefined();
	});

	test("a custom Other answer satisfies the Enter gate", () => {
		const multi = question({ multiSelect: true });
		let state = initialState([multi]);
		state = step(state, "down").state;
		state = step(state, "down").state; // onto "Other"
		const opened = step(state, "enter");
		expect(opened.effect).toEqual({ type: "openEditor" });

		const custom = applyCustomText(opened.state, "hand-rolled");
		expect(custom.effect).toEqual({ type: "submit" });
		expect(custom.state.selections.q1).toEqual({ type: "custom", text: "hand-rolled" });

		// Revisit an option row: Enter must advance, not reject the existing answer.
		const onOption = step(custom.state, "up").state;
		const revisited = step(onOption, "enter");
		expect(revisited.effect).toEqual({ type: "submit" });
	});
});

describe("multiple questions", () => {
	const questions = [question(), question({ id: "q2", header: "Scope", question: "Which scopes?" })];

	test("Enter advances to the next tab, then the Submit tab", () => {
		let state = initialState(questions);
		state = step(state, "enter").state;
		expect(state.tab).toBe(1);
		state = step(state, "enter").state;
		expect(state.tab).toBe(2);
		expect(currentQuestion(state)).toBeUndefined();
		expect(step(state, "enter").effect).toEqual({ type: "submit" });
	});

	test("blocks submit while a question is unanswered", () => {
		let state = initialState(questions);
		state = step(state, "enter").state; // answer Q1
		state = step(state, "right").state; // move to Submit with Q2 unanswered
		expect(state.tab).toBe(2);
		const blocked = step(state, "enter");
		expect(blocked.effect.type).toBe("blocked");
		expect(blocked.state.message).toContain("Answer every question");
	});

	test("submits once every question is answered", () => {
		let state = initialState(questions);
		state = step(state, "enter").state;
		state = step(state, "enter").state;
		expect(allAnswered(state)).toBe(true);
		expect(step(state, "enter").effect).toEqual({ type: "submit" });
	});

	test("tabs cycle with arrows", () => {
		let state = initialState(questions);
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
		const multi = question({ multiSelect: true });
		let state = initialState([question(), multi]);
		state = step(step(state, "down").state, "down").state;
		state = step(state, "enter").state; // Other
		expect(state.editing).toBe(true);

		const closed = step(state, "escape");
		expect(closed.effect).toEqual({ type: "closeEditor" });
		expect(closed.state.editing).toBe(false);
		expect(closed.state.selections.q1).toBeUndefined();
	});
});

/**
 * Keyboard/navigation state machine for the TUI questionnaire (pure).
 *
 * Terminal rendering and the text `Editor` live in `tui.ts`; this module only
 * owns selection state and transitions, so navigation, tab cycling,
 * multi-select toggling, submit gating, and cancellation can be tested without
 * a terminal.
 */

import type { Question, Selection } from "./types.ts";

export type KeyAction = "up" | "down" | "left" | "right" | "tab" | "shiftTab" | "enter" | "escape" | "space";

export type Effect =
	| { type: "none" }
	| { type: "render" }
	| { type: "cancel" }
	| { type: "openEditor" }
	| { type: "closeEditor" }
	| { type: "blocked"; message: string }
	| { type: "submit" };

export interface TuiState {
	questions: Question[];
	/** 0..questions.length, where `questions.length` is the Submit tab. */
	tab: number;
	/** Cursor within the current question's options (including the "Other" entry). */
	cursor: number;
	selections: Record<string, Selection>;
	editing: boolean;
	editingQuestionId: string | null;
	/** Transient validation message shown under the options. */
	message: string | null;
}

/** Number of selectable entries for a question, including the "Other" entry. */
export function optionCount(question: Question): number {
	return question.options.length + (question.allowOther ? 1 : 0);
}

/** The question for the current tab, or undefined on the Submit tab. */
export function currentQuestion(state: TuiState): Question | undefined {
	return state.tab < state.questions.length ? state.questions[state.tab] : undefined;
}

/** True when every question has an answer. */
export function allAnswered(state: TuiState): boolean {
	return state.questions.every((question) => state.selections[question.id] !== undefined);
}

/** Clamp the cursor and auto-open the editor for free-form-only questions. */
function sync(state: TuiState): TuiState {
	const question = currentQuestion(state);
	if (!question) return { ...state, editing: false, editingQuestionId: null, message: null };
	const count = optionCount(question);
	const cursor = count === 0 ? 0 : Math.min(state.cursor, count - 1);
	const next = { ...state, cursor };
	if (!next.editing && count === 0 && next.selections[question.id] === undefined) {
		return { ...next, editing: true, editingQuestionId: question.id };
	}
	return next;
}

export function initialState(questions: Question[]): TuiState {
	return sync({
		questions,
		tab: 0,
		cursor: 0,
		selections: {},
		editing: false,
		editingQuestionId: null,
		message: null,
	});
}

function openEditor(state: TuiState, question: Question): { state: TuiState; effect: Effect } {
	return {
		state: { ...state, editing: true, editingQuestionId: question.id, message: null },
		effect: { type: "openEditor" },
	};
}

/** Move one step, switching to the next question or the Submit tab at the end. */
function advance(state: TuiState): { state: TuiState; effect: Effect } {
	if (state.questions.length === 1) return { state, effect: { type: "submit" } };

	if (state.tab < state.questions.length - 1) {
		const next = sync({
			...state,
			tab: state.tab + 1,
			cursor: 0,
			editing: false,
			editingQuestionId: null,
			message: null,
		});
		return { state: next, effect: next.editing ? { type: "openEditor" } : { type: "render" } };
	}

	const next = sync({
		...state,
		tab: state.questions.length,
		cursor: 0,
		editing: false,
		editingQuestionId: null,
		message: null,
	});
	return { state: next, effect: { type: "render" } };
}

function changeTab(state: TuiState, delta: number): { state: TuiState; effect: Effect } {
	const total = state.questions.length + 1;
	const tab = (state.tab + delta + total) % total;
	const next = sync({ ...state, tab, cursor: 0, editing: false, editingQuestionId: null, message: null });
	return { state: next, effect: next.editing ? { type: "openEditor" } : { type: "render" } };
}

function toggleCurrent(state: TuiState, question: Question): { state: TuiState; effect: Effect } {
	if (state.cursor >= question.options.length) return { state, effect: { type: "none" } }; // "Other" opens on Enter
	const existing = state.selections[question.id];
	const current: Selection =
		existing?.type === "options" ? existing : { type: "options", values: [], labels: [], indices: [] };
	const position = current.indices.indexOf(state.cursor + 1);
	const values = [...current.values];
	const labels = [...current.labels];
	const indices = [...current.indices];
	if (position >= 0) {
		values.splice(position, 1);
		labels.splice(position, 1);
		indices.splice(position, 1);
	} else {
		values.push(question.options[state.cursor].label);
		labels.push(question.options[state.cursor].label);
		indices.push(state.cursor + 1);
	}

	const selections = { ...state.selections };
	if (indices.length === 0) delete selections[question.id];
	else selections[question.id] = { type: "options", values, labels, indices };
	return { state: { ...state, selections, message: null }, effect: { type: "render" } };
}

function confirmCurrent(state: TuiState, question: Question): { state: TuiState; effect: Effect } {
	const count = optionCount(question);
	const option = question.options[state.cursor];
	if (count === 0 || state.cursor >= question.options.length || !option) return openEditor(state, question);

	if (question.multiSelect) {
		const existing = state.selections[question.id];
		const answered = existing?.type === "custom" || (existing?.type === "options" && existing.indices.length > 0);
		if (!answered) {
			return {
				state: { ...state, message: "Select at least one option." },
				effect: { type: "blocked", message: "Select at least one option." },
			};
		}
		return advance(state);
	}

	const selection: Selection = {
		type: "options",
		values: [option.label],
		labels: [option.label],
		indices: [state.cursor + 1],
	};
	return advance({ ...state, selections: { ...state.selections, [question.id]: selection }, message: null });
}

/** Apply one keyboard action. */
export function reduce(state: TuiState, action: KeyAction): { state: TuiState; effect: Effect } {
	if (state.editing) {
		if (action === "escape") {
			return {
				state: sync({ ...state, editing: false, editingQuestionId: null, message: null }),
				effect: { type: "closeEditor" },
			};
		}
		return { state, effect: { type: "none" } };
	}

	const question = currentQuestion(state);

	if (state.questions.length > 1) {
		if (action === "tab" || action === "right") return changeTab(state, 1);
		if (action === "shiftTab" || action === "left") return changeTab(state, -1);
	}

	const submitTab = question === undefined;

	if (submitTab) {
		if (action === "enter") {
			if (allAnswered(state)) return { state, effect: { type: "submit" } };
			return {
				state: { ...state, message: "Answer every question before submitting." },
				effect: { type: "blocked", message: "Answer every question before submitting." },
			};
		}
		if (action === "escape") return { state, effect: { type: "cancel" } };
		return { state, effect: { type: "none" } };
	}

	const count = optionCount(question);
	if (action === "up") {
		return { state: { ...state, cursor: Math.max(0, state.cursor - 1), message: null }, effect: { type: "render" } };
	}
	if (action === "down") {
		const cursor = count === 0 ? 0 : Math.min(count - 1, state.cursor + 1);
		return { state: { ...state, cursor, message: null }, effect: { type: "render" } };
	}
	if (action === "space") {
		if (question.multiSelect) return toggleCurrent(state, question);
		return { state, effect: { type: "none" } };
	}
	if (action === "escape") return { state, effect: { type: "cancel" } };
	if (action === "enter") return confirmCurrent(state, question);
	return { state, effect: { type: "none" } };
}

/** Commit free-form text from the inline editor. */
export function applyCustomText(state: TuiState, text: string): { state: TuiState; effect: Effect } {
	const id = state.editingQuestionId;
	const trimmed = text.trim();
	if (!id || !trimmed) {
		return {
			state: sync({ ...state, editing: false, editingQuestionId: null, message: null }),
			effect: { type: "closeEditor" },
		};
	}

	const question = state.questions.find((candidate) => candidate.id === id);
	const next = sync({
		...state,
		selections: { ...state.selections, [id]: { type: "custom", text: trimmed } },
		editing: false,
		editingQuestionId: null,
		message: null,
	});
	if (!question) return { state: next, effect: { type: "closeEditor" } };
	return advance(next);
}

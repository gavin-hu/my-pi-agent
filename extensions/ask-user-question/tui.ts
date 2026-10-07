/**
 * Terminal UI driver for ask_user_question.
 *
 * The state machine lives in `tui-state.ts`; this module renders it and routes
 * keyboard input, including the inline `Editor` for free-form answers.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { OTHER_LABEL, cancelledResult, collectAnswers, completedResult, describeSelection } from "./answers.ts";
import {
	allAnswered,
	applyCustomText,
	currentQuestion,
	initialState,
	optionCount,
	reduce,
	type Effect,
	type KeyAction,
	type TuiState,
} from "./tui-state.ts";
import type { AskResult, Question, Selection } from "./types.ts";

type Outcome =
	| { type: "cancelled"; selections: Map<string, Selection> }
	| { type: "submitted"; selections: Map<string, Selection> };

/**
 * Lay atomic, ANSI-styled cells onto lines no wider than `width`.
 *
 * Cells are never split: a cell that would not fit moves to the next line, and
 * a cell wider than the whole viewport is truncated. This keeps tab labels and
 * the submit arrow intact instead of letting `wrapTextWithAnsi` break them
 * mid-token.
 */
function layoutCells(cells: string[], width: number): string[] {
	const lines: string[] = [];
	let current = "";
	let currentWidth = 0;
	for (const cell of cells) {
		let text = cell;
		let cellWidth = visibleWidth(cell);
		if (cellWidth > width) {
			text = truncateToWidth(cell, width);
			cellWidth = visibleWidth(text);
		}
		if (currentWidth > 0 && currentWidth + cellWidth > width) {
			lines.push(current);
			current = "";
			currentWidth = 0;
		}
		current += text;
		currentWidth += cellWidth;
	}
	lines.push(current);
	return lines;
}

function mapKey(data: string): KeyAction | undefined {
	if (matchesKey(data, Key.up)) return "up";
	if (matchesKey(data, Key.down)) return "down";
	if (matchesKey(data, Key.left)) return "left";
	if (matchesKey(data, Key.right)) return "right";
	if (matchesKey(data, Key.tab)) return "tab";
	if (matchesKey(data, Key.shift("tab"))) return "shiftTab";
	if (matchesKey(data, Key.space)) return "space";
	if (matchesKey(data, Key.enter)) return "enter";
	if (matchesKey(data, Key.escape)) return "escape";
	return undefined;
}

/** Run the tabbed questionnaire and return the resulting answers. */
export async function askViaTui(ctx: ExtensionContext, questions: Question[], signal?: AbortSignal): Promise<AskResult> {
	const outcome = await ctx.ui.custom<Outcome>((tui, theme, _keybindings, done) => {
		let state: TuiState = initialState(questions);
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;
		let settled = false;

		/** Snapshot the answers recorded so far, for submit or partial cancel. */
		const selectionMap = (): Map<string, Selection> => new Map(Object.entries(state.selections));

		const finish = (result: Outcome): void => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			done(result);
		};
		const onAbort = (): void => finish({ type: "cancelled", selections: selectionMap() });
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();

		const editorTheme: EditorTheme = {
			borderColor: (text) => theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			},
		};
		const editor = new Editor(tui, editorTheme);

		const refresh = (): void => {
			cachedWidth = undefined;
			cachedLines = undefined;
			tui.requestRender();
		};

		/** Resolve the interaction for terminal effects; returns true when finished. */
		const finishWith = (effect: Effect): boolean => {
			if (effect.type === "cancel") {
				finish({ type: "cancelled", selections: selectionMap() });
				return true;
			}
			if (effect.type === "submit") {
				finish({ type: "submitted", selections: selectionMap() });
				return true;
			}
			return false;
		};

		/** Finish, or refresh; clear the editor whenever it (re)opens for a fresh answer. */
		const settle = (effect: Effect): void => {
			if (finishWith(effect)) return;
			if (effect.type === "openEditor") editor.setText("");
			refresh();
		};

		editor.onSubmit = (value) => {
			const next = applyCustomText(state, value);
			state = next.state;
			settle(next.effect);
		};

		function handleInput(data: string): void {
			if (state.editing) {
				if (matchesKey(data, Key.escape)) {
					state = { ...state, editing: false, editingQuestionId: null, message: null };
					refresh();
					return;
				}
				editor.handleInput(data);
				refresh();
				return;
			}

			const action = mapKey(data);
			if (!action) return;
			const next = reduce(state, action);
			state = next.state;
			settle(next.effect);
		}

		function render(width: number): string[] {
			if (cachedLines && cachedWidth === width) return cachedLines;

			const lines: string[] = [];
			const renderWidth = Math.max(1, width);
			const question = currentQuestion(state);
			const isMulti = questions.length > 1;
			const submitTab = state.tab >= questions.length;

			const addWrapped = (text: string): void => {
				lines.push(...wrapTextWithAnsi(text, renderWidth));
			};
			const addWithPrefix = (prefix: string, text: string): void => {
				const prefixWidth = visibleWidth(prefix);
				if (prefixWidth >= renderWidth) {
					addWrapped(prefix + text);
					return;
				}
				const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
				const continuation = " ".repeat(prefixWidth);
				for (let i = 0; i < wrapped.length; i++) {
					lines.push(`${i === 0 ? prefix : continuation}${wrapped[i]}`);
				}
			};

			function renderOptions(target: Question): void {
				const selection = state.selections[target.id];
				const chosen = selection?.type === "options" ? selection.indices : [];
				const count = optionCount(target);
				for (let i = 0; i < count; i++) {
					const option = target.options[i];
					const active = i === state.cursor;
					const prefix = active ? theme.fg("accent", "> ") : "  ";
					if (!option) {
						const otherSelected = selection?.type === "custom";
						const otherMarker = target.multiSelect ? `[${otherSelected ? "x" : " "}] ` : "";
						const label = `${i + 1}. ${otherMarker}${OTHER_LABEL}${state.editing ? " ✎" : ""}`;
						addWithPrefix(prefix, theme.fg(active || state.editing ? "accent" : "text", label));
						continue;
					}
					const marker = target.multiSelect ? `[${chosen.includes(i + 1) ? "x" : " "}] ` : "";
					addWithPrefix(prefix, theme.fg(active ? "accent" : "text", `${i + 1}. ${marker}${option.label}`));
					if (option.description) {
						const indent = " ".repeat(visibleWidth(prefix) + String(i + 1).length + 2 + visibleWidth(marker));
						addWithPrefix(indent, theme.fg("muted", option.description));
					}
				}
			}

			lines.push(theme.fg("accent", "─".repeat(renderWidth)));

			if (isMulti) {
				const cells: string[] = [];
				for (let i = 0; i < questions.length; i++) {
					const answered = state.selections[questions[i].id] !== undefined;
					const active = i === state.tab;
					const text = ` ${answered ? "■" : "□"} ${questions[i].header} `;
					const styled = active
						? theme.bg("selectedBg", theme.fg("text", text))
						: theme.fg(answered ? "success" : "muted", text);
					// Keep the leading hint glued to the first tab so it never wraps alone.
					cells.push(cells.length === 0 ? `${theme.fg("muted", "← ")}${styled} ` : `${styled} `);
				}
				const canSubmit = allAnswered(state);
				const submitText = " ✓ Submit ";
				const submitStyled = submitTab
					? theme.bg("selectedBg", theme.fg("text", submitText))
					: theme.fg(canSubmit ? "success" : "dim", submitText);
				cells.push(`${submitStyled} →`);
				for (const tabLine of layoutCells(cells, Math.max(1, renderWidth - 1))) lines.push(` ${tabLine}`);
				lines.push("");
			}

			if (state.editing && question) {
				addWithPrefix(" ", theme.fg("text", question.question));
				lines.push("");
				renderOptions(question);
				lines.push("");
				addWithPrefix(" ", theme.fg("muted", "Your answer:"));
				const editorPad = renderWidth > 1 ? " " : "";
				for (const line of editor.render(Math.max(1, renderWidth - 2))) {
					lines.push(`${editorPad}${line}`);
				}
				lines.push("");
				if (state.message) addWithPrefix(" ", theme.fg("warning", state.message));
				addWithPrefix(" ", theme.fg("dim", "Enter to submit • Esc to go back"));
			} else if (submitTab) {
				addWithPrefix(" ", theme.fg("accent", theme.bold("Ready to submit")));
				lines.push("");
				for (const target of questions) {
					addWithPrefix(
						" ",
						`${theme.fg("muted", `${target.header}: `)}${theme.fg("text", describeSelection(state.selections[target.id]))}`,
					);
				}
				lines.push("");
				if (state.message) addWithPrefix(" ", theme.fg("warning", state.message));
				if (allAnswered(state)) {
					addWithPrefix(" ", theme.fg("success", "Press Enter to submit"));
				} else {
					const missing = questions
						.filter((target) => state.selections[target.id] === undefined)
						.map((target) => target.header)
						.join(", ");
					addWithPrefix(" ", theme.fg("warning", `Unanswered: ${missing}`));
				}
			} else if (question) {
				addWithPrefix(" ", theme.fg("text", question.question));
				lines.push("");
				renderOptions(question);
				lines.push("");
				if (state.message) addWithPrefix(" ", theme.fg("warning", state.message));
				const help =
					optionCount(question) === 0
						? "Enter to type an answer • Esc cancel"
						: question.multiSelect
							? "↑↓ move • Space toggle • Enter confirm • Esc cancel"
							: "↑↓ choose • Enter select • Esc cancel";
				addWithPrefix(" ", theme.fg("dim", `${isMulti ? "Tab/←→ navigate • " : ""}${help}`));
				if (question.multiSelect) {
					const selection = state.selections[question.id];
					if (selection?.type === "options" && selection.labels.length > 0) {
						addWithPrefix(" ", theme.fg("success", `Selected: ${selection.labels.join(", ")}`));
					} else if (selection?.type === "custom") {
						addWithPrefix(" ", theme.fg("success", `Selected: ${selection.text}`));
					}
				}
			}

			lines.push(theme.fg("accent", "─".repeat(renderWidth)));
			cachedWidth = width;
			cachedLines = lines;
			return lines;
		}

		return {
			render,
			invalidate: () => {
				cachedWidth = undefined;
				cachedLines = undefined;
			},
			handleInput,
			dispose: () => {
				signal?.removeEventListener("abort", onAbort);
			},
		};
	});

	if (outcome.type === "cancelled") return cancelledResult(questions, collectAnswers(questions, outcome.selections));
	return completedResult(questions, outcome.selections);
}

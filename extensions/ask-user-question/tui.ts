/**
 * Terminal UI driver for ask_user_question.
 *
 * The state machine lives in `tui-state.ts`; this module renders it and routes
 * keyboard input, including the inline `Editor` for free-form answers.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { OTHER_LABEL, cancelledResult, completedResult, describeSelection } from "./answers.ts";
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

type Outcome = { type: "cancelled" } | { type: "submitted"; selections: Map<string, Selection> };

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
		let cachedLines: string[] | undefined;
		let settled = false;

		const finish = (result: Outcome): void => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			done(result);
		};
		const onAbort = (): void => finish({ type: "cancelled" });
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
			cachedLines = undefined;
			tui.requestRender();
		};

		/** Resolve the interaction for terminal effects; returns true when finished. */
		const finishWith = (effect: Effect): boolean => {
			if (effect.type === "cancel") {
				finish({ type: "cancelled" });
				return true;
			}
			if (effect.type === "submit") {
				finish({ type: "submitted", selections: new Map(Object.entries(state.selections)) });
				return true;
			}
			return false;
		};

		editor.onSubmit = (value) => {
			const next = applyCustomText(state, value);
			state = next.state;
			if (!finishWith(next.effect)) refresh();
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
			if (!finishWith(next.effect)) refresh();
		}

		function render(width: number): string[] {
			if (cachedLines) return cachedLines;

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
						const label = `${i + 1}. ${OTHER_LABEL}${state.editing ? " ✎" : ""}`;
						addWithPrefix(prefix, theme.fg(active || state.editing ? "accent" : "text", label));
						continue;
					}
					const marker = target.multiSelect ? `[${chosen.includes(i + 1) ? "x" : " "}] ` : "";
					addWithPrefix(prefix, theme.fg(active ? "accent" : "text", `${i + 1}. ${marker}${option.label}`));
					if (option.description) addWithPrefix("     ", theme.fg("muted", option.description));
				}
			}

			lines.push(theme.fg("accent", "─".repeat(renderWidth)));

			if (isMulti) {
				const tabs: string[] = ["← "];
				for (let i = 0; i < questions.length; i++) {
					const answered = state.selections[questions[i].id] !== undefined;
					const active = i === state.tab;
					const text = ` ${answered ? "■" : "□"} ${questions[i].header} `;
					const styled = active
						? theme.bg("selectedBg", theme.fg("text", text))
						: theme.fg(answered ? "success" : "muted", text);
					tabs.push(`${styled} `);
				}
				const canSubmit = allAnswered(state);
				const submitText = " ✓ Submit ";
				const submitStyled = submitTab
					? theme.bg("selectedBg", theme.fg("text", submitText))
					: theme.fg(canSubmit ? "success" : "dim", submitText);
				tabs.push(`${submitStyled} →`);
				addWithPrefix(" ", tabs.join(""));
				lines.push("");
			}

			if (state.editing && question) {
				addWithPrefix(" ", theme.fg("text", question.question));
				lines.push("");
				renderOptions(question);
				lines.push("");
				addWithPrefix(" ", theme.fg("muted", "Your answer:"));
				for (const line of editor.render(Math.max(1, renderWidth - 2))) {
					lines.push(` ${line}`);
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
				const help = question.multiSelect
					? "↑↓ move • Space toggle • Enter confirm • Esc cancel"
					: "↑↓ navigate • Enter select • Esc cancel";
				addWithPrefix(" ", theme.fg("dim", `${isMulti ? "Tab/←→ navigate • " : ""}${help}`));
				if (question.multiSelect) {
					const selection = state.selections[question.id];
					if (selection?.type === "options" && selection.labels.length > 0) {
						addWithPrefix(" ", theme.fg("success", `Selected: ${selection.labels.join(", ")}`));
					}
				}
			}

			lines.push(theme.fg("accent", "─".repeat(renderWidth)));
			cachedLines = lines;
			return lines;
		}

		return {
			render,
			invalidate: () => {
				cachedLines = undefined;
			},
			handleInput,
			dispose: () => {
				signal?.removeEventListener("abort", onAbort);
			},
		};
	});

	if (outcome.type === "cancelled") return cancelledResult(questions);
	return completedResult(questions, outcome.selections);
}

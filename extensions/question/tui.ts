/**
 * Terminal UI driver for ask_user_question.
 *
 * The state machine lives in `tui-state.ts`; this module renders it and routes
 * keyboard input, including the inline `Editor` for free-form answers.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	Key,
	matchesKey,
	visibleWidth,
	wrapTextWithAnsi,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../lib/format.ts";
import { flowCells } from "../../lib/tui/columns.ts";
import { clampScroll, formatRange, keepVisible, selectionMarker, wheelDelta } from "../../lib/tui/cursor.ts";
import { editorTheme, screenHint } from "../../lib/tui/chrome.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { checkbox } from "../../lib/tui/rows.ts";
import { plainRule, titleRule } from "../../lib/tui/rules.ts";
import { paint } from "../../lib/tui/tokens.ts";
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

/** Index of the option block containing line `line`, given each block's first line. */
function blockAt(offsets: number[], line: number): number {
	let index = 0;
	for (let i = 0; i < offsets.length; i++) {
		if (offsets[i] > line) break;
		index = i;
	}
	return index;
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
export async function askViaTui(
	ctx: ExtensionContext,
	questions: Question[],
	signal?: AbortSignal,
): Promise<AskResult> {
	const outcome = await ctx.ui.custom<Outcome>((tui, theme, _keybindings, done) => {
		let state: TuiState = initialState(questions);
		let cachedWidth: number | undefined;
		let cachedRows: number | undefined;
		let cachedLines: string[] | undefined;
		/** First visible line of the option list, when it is clipped. */
		let optionsScroll = 0;
		let settled = false;

		/** Live terminal height, or undefined when the host does not report one. */
		const terminalRows = (): number | undefined => {
			const rows = tui.terminal?.rows;
			return typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? rows : undefined;
		};

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

		const editor = new Editor(tui, editorTheme(theme));

		// The TUI marks this component focused; forward that to the inline editor so
		// it emits the hardware cursor marker for IME placement (see docs/tui.md).
		let componentFocused = false;
		const syncEditorFocus = (): void => {
			editor.focused = componentFocused && state.editing;
		};

		const refresh = (): void => {
			cachedWidth = undefined;
			cachedRows = undefined;
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
			syncEditorFocus();
			const rows = terminalRows();
			if (cachedLines && cachedWidth === width && cachedRows === rows) return cachedLines;

			const lines: string[] = [];
			const renderWidth = Math.max(1, width);
			const question = currentQuestion(state);
			const isMulti = questions.length > 1;
			const submitTab = state.tab >= questions.length;

			/** Wrap `text` under `prefix`; only the first line carries the prefix. */
			const prefixWrapped = (prefix: string, text: string): string[] => {
				const prefixWidth = visibleWidth(prefix);
				if (prefixWidth >= renderWidth) return wrapTextWithAnsi(prefix + text, renderWidth);
				const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
				const continuation = " ".repeat(prefixWidth);
				return wrapped.map((line, index) => `${index === 0 ? prefix : continuation}${line}`);
			};
			const addWithPrefix = (prefix: string, text: string): void => {
				lines.push(...prefixWrapped(prefix, text));
			};

			/** One block of lines per option, so the option list can be windowed. */
			const renderOptionBlocks = (target: Question): string[][] => {
				const selection = state.selections[target.id];
				const chosen = selection?.type === "options" ? selection.indices : [];
				const count = optionCount(target);
				const blocks: string[][] = [];
				for (let i = 0; i < count; i++) {
					const option = target.options[i];
					const active = i === state.cursor;
					const prefix = selectionMarker(theme, active);
					if (!option) {
						const otherSelected = selection?.type === "custom";
						const box = target.multiSelect ? `${checkbox(theme, otherSelected)} ` : "";
						const tone = active || state.editing ? "accent" : "label";
						blocks.push(
							prefixWrapped(
								prefix,
								paint(theme, tone, `${i + 1}. `) +
									box +
									paint(theme, tone, `${OTHER_LABEL}${state.editing ? " ✎" : ""}`),
							),
						);
						continue;
					}
					const marker = target.multiSelect ? `${checkbox(theme, chosen.includes(i + 1))} ` : "";
					const label = sanitizeLine(option.label);
					const tone = active ? "accent" : "label";
					const block = prefixWrapped(prefix, paint(theme, tone, `${i + 1}. `) + marker + paint(theme, tone, label));
					if (option.description) {
						const indent = " ".repeat(visibleWidth(prefix) + String(i + 1).length + 2 + visibleWidth(marker));
						block.push(...prefixWrapped(indent, paint(theme, "meta", sanitizeLine(option.description))));
					}
					blocks.push(block);
				}
				return blocks;
			};

			lines.push(titleRule(theme, renderWidth, "Question"));

			if (isMulti) {
				const cells: string[] = [];
				for (let i = 0; i < questions.length; i++) {
					const answered = state.selections[questions[i].id] !== undefined;
					const active = i === state.tab;
					const text = ` ${answered ? GLYPHS.boxOn : GLYPHS.boxOff} ${sanitizeLine(questions[i].header)} `;
					const styled = active
						? theme.bg("selectedBg", paint(theme, "label", text))
						: paint(theme, answered ? "ok" : "meta", text);
					// Keep the leading hint glued to the first tab so it never wraps alone.
					cells.push(cells.length === 0 ? `${paint(theme, "meta", `${GLYPHS.prev} `)}${styled} ` : `${styled} `);
				}
				const canSubmit = allAnswered(state);
				const submitText = ` ${GLYPHS.check} Submit `;
				const submitStyled = submitTab
					? theme.bg("selectedBg", paint(theme, "label", submitText))
					: paint(theme, canSubmit ? "ok" : "faint", submitText);
				cells.push(`${submitStyled} ${GLYPHS.next}`);
				for (const tabLine of flowCells(cells, Math.max(1, renderWidth - 1))) lines.push(` ${tabLine}`);
				lines.push("");
			}

			if (state.editing && question) {
				addWithPrefix(" ", paint(theme, "label", sanitizeLine(question.question)));
				lines.push("");
				lines.push(...renderOptionBlocks(question).flat());
				lines.push("");
				addWithPrefix(" ", paint(theme, "meta", "Your answer:"));
				const editorPad = renderWidth > 1 ? " " : "";
				for (const line of editor.render(Math.max(1, renderWidth - 2))) {
					lines.push(`${editorPad}${line}`);
				}
				lines.push("");
				if (state.message) addWithPrefix(" ", paint(theme, "warn", state.message));
				lines.push(screenHint(theme, renderWidth, ["Enter to submit", "Esc to go back"]));
			} else if (submitTab) {
				addWithPrefix(" ", paint(theme, "accent", theme.bold("Ready to submit")));
				lines.push("");
				for (const target of questions) {
					addWithPrefix(
						" ",
						`${paint(theme, "meta", `${sanitizeLine(target.header)}: `)}${paint(theme, "label", sanitizeLine(describeSelection(state.selections[target.id])))}`,
					);
				}
				lines.push("");
				if (state.message) addWithPrefix(" ", paint(theme, "warn", state.message));
				if (allAnswered(state)) {
					addWithPrefix(" ", paint(theme, "ok", "Press Enter to submit"));
				} else {
					const missing = questions
						.filter((target) => state.selections[target.id] === undefined)
						.map((target) => sanitizeLine(target.header))
						.join(", ");
					addWithPrefix(" ", paint(theme, "warn", `Unanswered: ${missing}`));
				}
			} else if (question) {
				addWithPrefix(" ", paint(theme, "label", sanitizeLine(question.question)));
				lines.push("");
				const blocks = renderOptionBlocks(question);

				// Everything after the options is fixed chrome; build it first so the
				// option list can be given exactly the rows that are left.
				const tail: string[] = [""];
				if (state.message) tail.push(...prefixWrapped(" ", paint(theme, "warn", state.message)));
				const hints =
					optionCount(question) === 0
						? ["Enter to type an answer", "Esc cancel"]
						: question.multiSelect
							? ["↑/↓ move", "Space toggle", "Enter confirm", "Esc cancel"]
							: ["↑/↓ choose", "Enter select", "Esc cancel"];
				if (isMulti) hints.unshift(`Tab/${GLYPHS.prev}${GLYPHS.next} navigate`);
				tail.push(screenHint(theme, renderWidth, hints));
				if (question.multiSelect) {
					const selection = state.selections[question.id];
					if (selection?.type === "options" && selection.labels.length > 0) {
						tail.push(
							...prefixWrapped(" ", paint(theme, "ok", `Selected: ${selection.labels.map(sanitizeLine).join(", ")}`)),
						);
					} else if (selection?.type === "custom") {
						tail.push(...prefixWrapped(" ", paint(theme, "ok", `Selected: ${sanitizeLine(selection.text)}`)));
					}
				}

				// Window the option list into the rows left after the fixed chrome and the
				// closing rule. The focused option stays visible; a clipped list says which
				// options it is showing rather than silently dropping the tail.
				const flat = blocks.flat();
				const fixed = lines.length + tail.length + 1;
				const budget = rows === undefined ? Number.POSITIVE_INFINITY : Math.max(1, rows - fixed);
				if (flat.length > budget) {
					const usable = Math.max(1, budget - 1);
					const offsets: number[] = [];
					let offset = 0;
					for (const block of blocks) {
						offsets.push(offset);
						offset += block.length;
					}
					const focusLine = offsets[Math.min(state.cursor, offsets.length - 1)] ?? 0;
					optionsScroll = clampScroll(keepVisible(optionsScroll, focusLine, usable), flat.length, usable);
					const end = Math.min(flat.length, optionsScroll + usable);
					lines.push(...flat.slice(optionsScroll, end));
					lines.push(
						formatRange(theme, renderWidth, {
							start: blockAt(offsets, optionsScroll),
							end: blockAt(offsets, end - 1) + 1,
							total: blocks.length,
							label: "option",
						}),
					);
				} else {
					lines.push(...flat);
				}
				lines.push(...tail);
			}

			lines.push(plainRule(theme, renderWidth));
			cachedWidth = width;
			cachedRows = rows;
			cachedLines = lines;
			return lines;
		}

		return {
			render,
			invalidate: () => {
				cachedWidth = undefined;
				cachedRows = undefined;
				cachedLines = undefined;
			},
			handleInput,
			handleMouse: (event: TuiMouseEvent): TuiMouseEventResult | undefined => {
				const delta = wheelDelta(event);
				if (delta === undefined) return undefined;
				// The render clamps the scroll once it knows how many rows are left.
				optionsScroll = Math.max(0, optionsScroll + delta);
				refresh();
				return { handled: true };
			},
			dispose: () => {
				signal?.removeEventListener("abort", onAbort);
				editor.focused = false;
			},
			get focused() {
				return componentFocused;
			},
			set focused(value: boolean) {
				if (componentFocused === value) return;
				componentFocused = value;
				syncEditorFocus();
				refresh();
			},
		};
	});

	if (outcome.type === "cancelled") return cancelledResult(questions, collectAnswers(questions, outcome.selections));
	return completedResult(questions, outcome.selections);
}

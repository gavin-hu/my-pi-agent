/**
 * Model-facing and transcript text for the todo list (pure).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { BODY_INDENT, GLYPH_GAP } from "../../lib/ui.ts";
import { completedCount, currentTodo } from "./state.ts";
import type { Todo, TodoStatus } from "./types.ts";

/** Sort order so the widget and transcript surface current work before finished rows. */
const STATUS_ORDER: Record<TodoStatus, number> = { in_progress: 0, pending: 1, completed: 2 };

/** Compare todos so `in_progress` sorts before `pending` before `completed` (stable). */
export function compareByActivity(a: Todo, b: Todo): number {
	return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
}

/** Longest first-item preview shown in the transcript call line. */
const CALL_PREVIEW_WIDTH = 40;

/** Plain status glyph per status; `todoGlyph` adds the theme color. */
const STATUS_GLYPH: Record<TodoStatus, string> = {
	pending: "○",
	in_progress: "◐",
	completed: "✓",
};

/** Themed status glyph, shared by the widget and the transcript renderer. */
export function todoGlyph(todo: Todo, theme: Theme): string {
	switch (todo.status) {
		case "completed":
			return theme.fg("success", STATUS_GLYPH.completed);
		case "in_progress":
			return theme.fg("accent", STATUS_GLYPH.in_progress);
		default:
			return theme.fg("dim", STATUS_GLYPH.pending);
	}
}

/** Themed item text: completed dim, in-progress accented, pending muted. */
export function todoLabel(todo: Todo, theme: Theme): string {
	if (todo.status === "completed") return theme.fg("dim", todo.content);
	if (todo.status === "in_progress") return theme.fg("text", todo.activeForm ?? todo.content);
	return theme.fg("muted", todo.content);
}

/** "2/5" — completed over total. */
export function progressCount(todos: Todo[]): string {
	if (todos.length === 0) return "0/0";
	return `${completedCount(todos)}/${todos.length}`;
}

/** "2/5 completed", or a note when the list is empty. */
export function progressSummary(todos: Todo[]): string {
	if (todos.length === 0) return "No todos";
	return `${progressCount(todos)} completed`;
}

/** Numbered checklist, one item per line, using the shared status glyphs. */
export function formatTodoList(todos: Todo[]): string {
	if (todos.length === 0) return "No todos.";
	return todos.map((todo, i) => `${i + 1}. ${STATUS_GLYPH[todo.status]} ${todo.content}`).join("\n");
}

/**
 * The model-facing result: a compact progress summary and the current item.
 *
 * The model just sent the full list, so echoing the checklist back only spends
 * context. The complete list lives in the tool-result `details` (for branch
 * reconstruction and rendering) and is shown by `/todos`.
 */
export function formatTodoText(todos: Todo[]): string {
	if (todos.length === 0) return "Todo list cleared.";

	const lines = [progressSummary(todos)];
	const current = currentTodo(todos);
	if (current) {
		const label = current.status === "in_progress" ? "In progress" : "Next";
		lines.push(`${label}: ${current.activeForm ?? current.content}`);
	}
	return lines.join("\n");
}

/**
 * One-line body for the transcript call renderer.
 *
 * The renderer owns the styled `todo ` title, so this returns only the body.
 * `todos` is `undefined` while the call's arguments are still streaming, which
 * is distinct from an empty list (a real clear). `argsComplete` disambiguates
 * the tail end of the stream.
 */
export function formatCallText(todos: { content?: string }[] | undefined, argsComplete = true): string {
	if (todos === undefined) return argsComplete ? "→ clear list" : "→ …";
	const count = todos.length;
	if (count === 0) return "→ clear list";
	const item = todos[0]?.content?.trim();
	const noun = count === 1 ? "item" : "items";
	if (!item) return `→ ${count} ${noun}`;
	// `strict` drops a wide grapheme that would cross the boundary, so the slice
	// plus ellipsis never exceeds `CALL_PREVIEW_WIDTH` columns.
	const preview =
		visibleWidth(item) > CALL_PREVIEW_WIDTH ? `${sliceByColumn(item, 0, CALL_PREVIEW_WIDTH - 1, true)}…` : item;
	return `→ ${count} ${noun}: ${preview}${count > 1 ? ", …" : ""}`;
}

/** Rows and footer for the transcript result rail. */
export interface TodoRailInput {
	/** The complete list, for the progress footer. */
	all: Todo[];
	/** Rows to draw, already ordered and capped by the caller. */
	rows: Todo[];
	/** Omitted row count, or 0 when nothing was capped. */
	more?: number;
}

/**
 * Transcript result rail: each row is indented by `BODY_INDENT`, led by its
 * status glyph, and its label wrapped with continuation rows aligned under the
 * text. A trailing `… N more` (when rows were capped) and the dim progress
 * summary follow, aligned to the text column. Every line is clipped to `width`.
 */
export function todoRailLines(input: TodoRailInput, theme: Theme, width: number): string[] {
	const w = Math.max(1, width);
	// All three status glyphs are single-column, so the text column is fixed.
	const textColumn = BODY_INDENT + 1 + GLYPH_GAP;
	const inner = Math.max(1, w - textColumn);
	const pad = " ".repeat(BODY_INDENT);
	const gap = " ".repeat(GLYPH_GAP);
	const continuation = " ".repeat(textColumn);
	const lines: string[] = [];
	for (const todo of input.rows) {
		const glyph = todoGlyph(todo, theme);
		const wrapped = wrapTextWithAnsi(todoLabel(todo, theme), inner);
		wrapped.forEach((line, index) => {
			lines.push(index === 0 ? `${pad}${glyph}${gap}${line}` : `${continuation}${line}`);
		});
	}
	if (input.more && input.more > 0) {
		lines.push(`${continuation}${theme.fg("dim", `… ${input.more} more`)}`);
	}
	lines.push(`${continuation}${theme.fg("dim", progressSummary(input.all))}`);
	return lines.map((line) => truncateToWidth(line, w, "…"));
}

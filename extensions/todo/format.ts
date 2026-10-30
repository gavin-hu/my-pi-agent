/**
 * Model-facing and transcript text for the todo list (pure).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { GLYPH_GAP, GLYPHS } from "../../lib/tui/glyphs.ts";
import { listRow } from "../../lib/tui/rows.ts";
import { overflowHint } from "../../lib/tui/tool.ts";
import { paint, type TuiRole } from "../../lib/tui/tokens.ts";
import { completedCount, currentTodo } from "./state.ts";
import type { Todo, TodoStatus } from "./types.ts";

/** One indented item line, clipped to `width`. */
export function todoRow(todo: Todo, theme: Theme, width: number): string {
	return listRow(theme, width, {
		glyph: todoGlyphChar(todo),
		glyphRole: todoGlyphRole(todo),
		label: todoLabelText(todo),
		labelRole: todoLabelRole(todo),
	});
}

/** Sort order so the widget and transcript surface current work before finished rows. */
const STATUS_ORDER: Record<TodoStatus, number> = { in_progress: 0, pending: 1, completed: 2 };

/** Compare todos so `in_progress` sorts before `pending` before `completed` (stable). */
export function compareByActivity(a: Todo, b: Todo): number {
	return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
}

/** Plain status glyph per status; `todoGlyph` adds the theme color. */
const STATUS_GLYPH: Record<TodoStatus, string> = {
	pending: GLYPHS.pending,
	in_progress: GLYPHS.half,
	completed: GLYPHS.check,
};

/** The design role a status glyph is drawn in. */
export function todoGlyphRole(todo: Todo): TuiRole {
	switch (todo.status) {
		case "completed":
			return "ok";
		case "in_progress":
			return "accent";
		default:
			return "faint";
	}
}

/** The status glyph, from the shared vocabulary. */
export function todoGlyphChar(todo: Todo): string {
	return STATUS_GLYPH[todo.status];
}

/** The design role an item label is drawn in. */
export function todoLabelRole(todo: Todo): TuiRole {
	if (todo.status === "completed") return "faint";
	if (todo.status === "in_progress") return "label";
	return "meta";
}

/** The item text: the active form while in progress, the content otherwise. */
export function todoLabelText(todo: Todo): string {
	return todo.status === "in_progress" ? (todo.activeForm ?? todo.content) : todo.content;
}

/** Themed status glyph, shared by the widget and the transcript renderer. */
export function todoGlyph(todo: Todo, theme: Theme): string {
	return paint(theme, todoGlyphRole(todo), todoGlyphChar(todo));
}

/** Themed item text: completed dim, in-progress accented, pending muted. */
export function todoLabel(todo: Todo, theme: Theme): string {
	return paint(theme, todoLabelRole(todo), todoLabelText(todo));
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
 * Progress is the summary; the result rail lists the items (active work first),
 * so the call line does not repeat the current item. `todos` is `undefined`
 * while the call's arguments are still streaming, which is distinct from an
 * empty list (a real clear). `argsComplete` disambiguates the tail end of the
 * stream.
 */
export function formatCallText(todos: Todo[] | undefined, argsComplete = true): string {
	if (todos === undefined) return argsComplete ? "→ clear list" : "→ …";
	if (todos.length === 0) return "→ clear list";
	return `→ ${progressCount(todos)}`;
}

/** Rows and footer for the transcript result rail. */
export interface TodoRailInput {
	/** Rows to draw, already ordered and capped by the caller. */
	rows: Todo[];
	/** Omitted row count, or 0 when nothing was capped. */
	more?: number;
}

/**
 * Transcript result rail: each row is led by its status glyph, and its label
 * wrapped with continuation rows aligned under the text. A trailing `… N more`
 * follows when rows were capped. Progress lives on the call line, so the rail
 * carries no footer. Every line is clipped to `width`.
 *
 * The rail draws at its own left edge; the tool-block frame supplies
 * `BODY_INDENT`, so the rail must not add it again.
 */
export function todoRailLines(input: TodoRailInput, theme: Theme, width: number): string[] {
	const w = Math.max(1, width);
	// All three status glyphs are single-column, so the text column is fixed.
	const textColumn = 1 + GLYPH_GAP;
	const inner = Math.max(1, w - textColumn);
	const gap = " ".repeat(GLYPH_GAP);
	const continuation = " ".repeat(textColumn);
	const lines: string[] = [];
	for (const todo of input.rows) {
		const glyph = todoGlyph(todo, theme);
		const wrapped = wrapTextWithAnsi(todoLabel(todo, theme), inner);
		wrapped.forEach((line, index) => {
			lines.push(index === 0 ? `${glyph}${gap}${line}` : `${continuation}${line}`);
		});
	}
	if (input.more && input.more > 0) {
		lines.push(`${continuation}${overflowHint(theme, input.more)}`);
	}
	return lines.map((line) => truncateToWidth(line, w, "…"));
}

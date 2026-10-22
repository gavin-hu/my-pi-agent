/**
 * Model-facing registration for the `todo` tool.
 *
 * The tool is a whole-list replacement: the model sends the complete list, and
 * the previous list is discarded. An empty list clears. The tool's own semantic
 * validation (one `in_progress` item, `activeForm`, duplicates, length) comes
 * back as an error result carrying the unchanged list, so the model can retry
 * without corrupting state. Argument-level failures the host rejects before
 * `execute` (an unknown `status`, a wrong type) surface the host's message
 * instead; the list is unchanged either way.
 */

import type { JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TODO_TOOL } from "../../lib/tool-names.ts";
import { failedResult, textResult } from "../../lib/tool-result.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { normalizeTodos } from "../../lib/todo-state.ts";
import { callLine, detailsOrLine, rejectionLine } from "../../lib/tui/tool.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { compareByActivity, formatCallText, formatTodoText, type TodoRailInput } from "./format.ts";
import type { TodoRuntime } from "./runtime.ts";
import { TodoParams, TodoResult, type TodoArgs } from "./schema.ts";
import { TodoResult as TodoResultView } from "./tui.ts";
import type { Todo, TodoDetails } from "./types.ts";

export const TOOL_NAME = TODO_TOOL;

/** Rows shown in an unexpanded transcript result before collapsing. */
const COLLAPSED_ROWS = 6;

/**
 * JSON-safe mirror of the list for `structuredContent`.
 *
 * `JsonValue` forbids `undefined`, so an absent `activeForm` is omitted rather
 * than set to `undefined`, and `error` is added only on failure.
 */
function toStructuredContent(todos: Todo[], action: "write" | "clear", error?: string): Record<string, JsonValue> {
	const content: Record<string, JsonValue> = {
		todos: todos.map((todo) => {
			const item: Record<string, JsonValue> = { content: todo.content, status: todo.status };
			if (todo.activeForm !== undefined) item.activeForm = todo.activeForm;
			return item;
		}),
		action,
	};
	if (error !== undefined) content.error = error;
	return content;
}

/**
 * Build the tool result for one call. A rejected call (`error` set) carries the
 * unchanged list so the model can retry, and is marked `isError`.
 */
function todoResult(todos: Todo[], action: "write" | "clear", error?: string) {
	const details: TodoDetails = error === undefined ? { todos, action } : { todos, action, error };
	const structuredContent = toStructuredContent(todos, action, error);
	return error === undefined
		? textResult(formatTodoText(todos), details, structuredContent)
		: failedResult(`Error: ${error}`, details, structuredContent);
}

export function registerTools(pi: ExtensionAPI, runtime: TodoRuntime): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Todo",
		description:
			"Record and update the task list for the current work. Send the complete list on every call; it replaces the " +
			"previous list, and an empty list clears it. Each item has a status — `pending`, `in_progress`, or " +
			"`completed` — and at most one item may be `in_progress`, which requires a present-continuous `activeForm` " +
			"label.",
		promptSnippet: "Track a multi-step task list (whole-list replacement).",
		promptGuidelines: [
			"Use todo for multi-step work so the user can see progress, and update it as you go, not only at the end.",
			"Update the list before starting a new step, not only after finishing one.",
			"Mark a finished item completed and promote the next item to in_progress in the same call, so the list never lags the work.",
		],
		parameters: TodoParams,
		outputSchema: TodoResult,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const todosArg = (params as Partial<TodoArgs> | undefined)?.todos;
			const action = Array.isArray(todosArg) && todosArg.length === 0 ? "clear" : "write";
			try {
				if (!Array.isArray(todosArg)) throw new Error("todos must be an array.");
				const todos = normalizeTodos(todosArg);
				runtime.setTodos(todos, ctx);
				return todoResult(todos, action);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return todoResult(runtime.getTodos(), action, message);
			}
		},

		renderCall(args, theme, context) {
			const body = formatCallText(args.todos as Todo[] | undefined, context.argsComplete);
			return callLine(theme, context.lastComponent, TOOL_NAME, body);
		},

		renderResult(result, { expanded }, theme, context) {
			const text = reuseText(context.lastComponent);
			const outcome = detailsOrLine(theme, result, expanded, toolDetails<TodoDetails>(result.details));
			if ("line" in outcome) {
				text.setText(outcome.line);
				return text;
			}
			const details = outcome.details;
			// A details block can still arrive without the list: the host rejected the
			// arguments, so its message is the whole result.
			if (!Array.isArray(details.todos)) {
				text.setText(rejectionLine(theme, result, expanded));
				return text;
			}
			if (details.todos.length === 0) {
				text.setText(paint(theme, "ok", `${GLYPHS.check} `) + paint(theme, "meta", "Cleared the todo list"));
				return text;
			}

			// Expanded keeps the model's order; collapsed leads with active work so the
			// in-progress item is visible, matching the widget.
			const ordered = [...details.todos].sort(compareByActivity);
			const rows = expanded ? details.todos : ordered.slice(0, COLLAPSED_ROWS);
			const more = expanded ? 0 : details.todos.length - rows.length;
			const input: TodoRailInput = { rows, more };
			const view =
				context.lastComponent instanceof TodoResultView ? context.lastComponent : new TodoResultView(input, theme);
			view.setInput(input, theme);
			return view;
		},
	});
}

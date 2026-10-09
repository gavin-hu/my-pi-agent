/**
 * Model-facing registration for the `todo` tool.
 *
 * The tool is a whole-list replacement: the model sends the complete list, and
 * the previous list is discarded. An empty list clears. Validation failures come
 * back as an error result carrying the unchanged list, so the model can retry
 * without corrupting state.
 */

import type { JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { TODO_TOOL } from "../../lib/tool-names.ts";
import { compareByActivity, formatCallText, formatTodoText, type TodoRailInput } from "./format.ts";
import type { TodoRuntime } from "./runtime.ts";
import { normalizeTodos, TodoParams, TodoResult, type TodoArgs } from "./schema.ts";
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
	return {
		content: [{ type: "text" as const, text: error === undefined ? formatTodoText(todos) : `Error: ${error}` }],
		details,
		structuredContent: toStructuredContent(todos, action, error),
		...(error === undefined ? {} : { isError: true as const }),
	};
}

export function registerTools(pi: ExtensionAPI, runtime: TodoRuntime): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Todo",
		description:
			"Record and update the task list for the current work. Send the complete list on every call; it replaces the " +
			"previous list, and an empty list clears it. Give every item a status: `pending`, `in_progress`, or " +
			"`completed`. Keep at most one item `in_progress`, and mark items `completed` immediately after finishing " +
			"them. Use this for multi-step work so the user can see the plan and progress.",
		promptSnippet: "Track a task list for the current work (whole-list replacement).",
		promptGuidelines: [
			"Use todo to plan multi-step work, and update it as you go rather than only at the end.",
			"Send the full list on every todo call; it replaces the previous list and an empty list clears it.",
			"Keep exactly one item in_progress at a time.",
			"Mark an item completed in the same turn you finish it, and promote the next item to in_progress in that same call, so the list never lags the work.",
			"Update the list before starting a new step, not only after finishing one.",
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
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			text.setText(
				theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) +
					theme.fg("muted", formatCallText(args.todos as Todo[] | undefined, context.argsComplete)),
			);
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = result.details as TodoDetails | undefined;
			if (!details) {
				const first = result.content[0];
				text.setText(first?.type === "text" ? first.text : "");
				return text;
			}
			if (details.error) {
				text.setText(theme.fg("error", `Error: ${details.error}`));
				return text;
			}
			if (details.todos.length === 0) {
				text.setText(theme.fg("success", "✓ ") + theme.fg("muted", "Cleared the todo list"));
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

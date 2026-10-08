/**
 * Model-facing registration for the `todo` tool.
 *
 * The tool is a whole-list replacement: the model sends the complete list, and
 * the previous list is discarded. An empty list clears. Validation failures come
 * back as an error result carrying the unchanged list, so the model can retry
 * without corrupting state.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { compareByActivity, formatCallText, formatTodoText, progressSummary, todoGlyph, todoLabel } from "./format.ts";
import type { TodoRuntime } from "./runtime.ts";
import { normalizeTodos, TodoParams, type TodoArgs } from "./schema.ts";
import type { TodoDetails } from "./types.ts";

export const TOOL_NAME = "todo";

/** Rows shown in an unexpanded transcript result before collapsing. */
const COLLAPSED_ROWS = 6;

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
		],
		parameters: TodoParams,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as TodoArgs;
			const action = args.todos.length === 0 ? "clear" : "write";
			try {
				const todos = normalizeTodos(args.todos);
				runtime.setTodos(todos, ctx);
				return {
					content: [{ type: "text", text: formatTodoText(todos) }],
					details: { todos, action } satisfies TodoDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { todos: runtime.getTodos(), action: "write", error: message } satisfies TodoDetails,
					isError: true,
				};
			}
		},

		renderCall(args, theme, context) {
			return new Text(
				theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) +
					theme.fg("muted", formatCallText(args.todos, context.argsComplete)),
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as TodoDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			if (details.todos.length === 0) {
				return new Text(theme.fg("success", "✓ ") + theme.fg("muted", "Cleared the todo list"), 0, 0);
			}

			// Expanded keeps the model's order; collapsed leads with active work so the
			// in-progress item is visible, matching the widget.
			const ordered = [...details.todos].sort(compareByActivity);
			const shown = expanded ? details.todos : ordered.slice(0, COLLAPSED_ROWS);
			const lines = shown.map((todo) => `${todoGlyph(todo, theme)} ${todoLabel(todo, theme)}`);
			if (!expanded && details.todos.length > shown.length) {
				lines.push(theme.fg("dim", `… ${details.todos.length - shown.length} more`));
			}
			lines.push(theme.fg("dim", progressSummary(details.todos)));
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}

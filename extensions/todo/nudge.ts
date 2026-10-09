/**
 * Lag detection for the todo extension (pure).
 *
 * The model is asked to keep the list current, but nothing forces it to; a run
 * can end with the list still showing work that is already done. The extension
 * turns that into one forced continuation with a short reminder, injected at
 * the `agent_before_settle` boundary. This module holds the pure pieces: which
 * tool calls count as work, when a reminder is due, and the reminder text.
 *
 * Mutation is an explicit list, not the MCP default. For a nudge a false
 * positive costs a whole extra model request, so an unrecognized reader must
 * not trigger one; missing a reminder is the safer failure. MCP tools that
 * declare `readOnlyHint: false` are still caught.
 */

import type { ToolAnnotations } from "@earendil-works/pi-coding-agent";
import { TODO_TOOL } from "../../lib/tool-names.ts";
import { currentTodo, hasOpenTodos } from "./state.ts";
import type { Todo } from "./types.ts";

/**
 * Tools whose calls mean the working tree may have changed: the built-in
 * writers and shells. Kept explicit so a reader or an MCP tool that does not
 * declare a hint cannot force a continuation.
 */
export const MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set(["write", "edit", "bash", "powershell"]);

/**
 * Whether a finished tool call counts as work for lag detection. The `todo`
 * tool never does (it is the update itself), a known mutator always does, and
 * any other tool counts only when it explicitly declares `readOnlyHint: false`.
 */
export function isMutatingTool(toolName: string, annotations?: ToolAnnotations): boolean {
	if (toolName === TODO_TOOL) return false;
	if (MUTATING_TOOL_NAMES.has(toolName)) return true;
	return annotations?.readOnlyHint === false;
}

/**
 * Whether a reminder is due: work happened since the last update, no reminder
 * was sent for it yet, and the list still has an unfinished item.
 */
export function shouldNudge(dirty: boolean, nudged: boolean, todos: Todo[]): boolean {
	return dirty && !nudged && hasOpenTodos(todos);
}

/** Marker on the injected reminder, so it is recognizable and filterable. */
export const TODO_NUDGE_MARKER = "[TODO SYNC]";

/**
 * Model-facing reminder injected before settlement. Points at the item the list
 * currently considers active, so the model can correct it without rereading the
 * whole list.
 */
export function formatNudge(todos: Todo[]): string {
	const current = currentTodo(todos);
	const item = current ? (current.activeForm ?? current.content) : undefined;
	const pointer = item ? ` The list still points at "${item}".` : "";
	return (
		`${TODO_NUDGE_MARKER} Work happened since the todo list was last updated, but the list still has ` +
		`unfinished items.${pointer} Call the todo tool to mark what is done and set the next item ` +
		"in_progress, then continue."
	);
}

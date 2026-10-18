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
 * Successful mutating calls needed before a run with no list at all is worth a
 * reminder. A plan that was never started has no item to fall behind, and a
 * false positive costs a whole extra model request, so one edit is not enough
 * evidence that the work needed a list.
 */
export const EMPTY_LIST_MUTATIONS = 3;

/** What the current turn knows about its work and the list. */
export interface NudgeState {
	/** Successful mutating calls since the turn began or the list was last written. */
	mutations: number;
	/** Whether the model wrote or cleared the list since the turn began. */
	touched: boolean;
	/** Whether a reminder was already sent this turn. */
	nudged: boolean;
	/** The current list. */
	todos: Todo[];
}

/**
 * Whether a reminder is due. With an unfinished item, one mutation is enough.
 * With no list at all, only repeated work is: a list the model wrote or cleared
 * this turn is its own answer, so an explicit clear is never second-guessed.
 */
export function shouldNudge({ mutations, touched, nudged, todos }: NudgeState): boolean {
	if (nudged || mutations <= 0) return false;
	if (hasOpenTodos(todos)) return true;
	return todos.length === 0 && !touched && mutations >= EMPTY_LIST_MUTATIONS;
}

/** Marker on the injected reminder, so it is recognizable and filterable. */
export const TODO_NUDGE_MARKER = "[TODO SYNC]";

/**
 * Model-facing reminder injected before settlement. For a list with unfinished
 * work it points at the item the list currently considers active, so the model
 * can correct it without rereading the whole list; for no list at all it asks
 * for one.
 */
export function formatNudge(todos: Todo[]): string {
	if (todos.length === 0) {
		return (
			`${TODO_NUDGE_MARKER} Several files or commands were changed but no todo list was recorded. ` +
			"Call the todo tool with the steps of the current work, then continue."
		);
	}
	const current = currentTodo(todos);
	const item = current ? (current.activeForm ?? current.content) : undefined;
	const pointer = item ? ` The list still points at "${item}".` : "";
	return (
		`${TODO_NUDGE_MARKER} Work happened since the todo list was last updated, but the list still has ` +
		`unfinished items.${pointer} Call the todo tool to mark what is done and set the next item ` +
		"in_progress, then continue."
	);
}

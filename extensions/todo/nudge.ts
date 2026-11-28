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
 *
 * A hint answers "can it write anything?", which is not the question a list
 * needs: it needs "did the working tree change?". The calls below reach the agent
 * directory, the bus, or something outside the tree; a board verb that is not
 * `review` or `land` does the same, and so does a delegated child asked to read.
 * None of it is work.
 */

import type { ToolAnnotations } from "@earendil-works/pi-coding-agent";
import { isBoardWork, isSubagentWork } from "../../lib/policy.ts";
import {
	BOARD_TOOL,
	GOAL_TOOL,
	PLAN_TOOL,
	SESSION_TOOL,
	SUBAGENT_TOOL,
	TEAM_TOOL,
	TODO_TOOL,
} from "../../lib/tool-names.ts";
import { currentTodo, hasOpenTodos } from "./state.ts";
import type { Todo } from "./types.ts";

/** Tools that run a command, where reading and writing look the same by name. */
const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set(["bash", "powershell"]);

/**
 * Tools whose calls mean the working tree may have changed: the built-in
 * writers and the shells. Kept explicit so a reader or an MCP tool that does not
 * declare a hint cannot force a continuation.
 */
export const MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set(["write", "edit", ...SHELL_TOOL_NAMES]);

/**
 * Tools whose call cannot have changed the checkout, so a turn that used one has
 * not fallen behind a list. Each name is here for its own reason rather than
 * because they are alike: `todo`, `goal`, `plan` and `session` publish session
 * state, `team` is the bus over the board, `memory` reads and writes the
 * agent-directory store, and a WeChat send, an app launch and a served review page
 * reach only outside the tree. Every other writer is judged by its hint.
 *
 * Four are spelled here rather than imported: this file already spells the built-in
 * names (`write`, `edit`, the shells) the same way, and four names with one reader do
 * not need a shared home. This set is then their only other reader, so a *new* call
 * that cannot change a checkout has to be added here by hand — nothing else can
 * declare it, and a false positive spends a model request while a missed reminder
 * costs nothing. `job`, `watch` and `worktree` are deliberately absent: they start a
 * command in a tree or move the checkout.
 *
 * `file-open`'s `readOnlyHint: false` is deliberate — plan mode admits tools by
 * that hint, and launching an application must stay behind the normal policy — so
 * `open_path` is excluded here, and the annotation is not touched.
 */
export const NON_WORK_TOOL_NAMES: ReadonlySet<string> = new Set([
	TODO_TOOL,
	GOAL_TOOL,
	PLAN_TOOL,
	SESSION_TOOL,
	TEAM_TOOL,
	"memory",
	"send_wechat",
	"open_path",
	"code_review",
]);

/**
 * Whether a finished tool call counts as work for lag detection. A non-work tool
 * never does, a known mutator always does, and any other tool counts only when it
 * explicitly declares `readOnlyHint: false`.
 *
 * `board` is one tool over thirteen actions, so its hint says "may write" and
 * cannot answer this either: the action the result reports can. A card write is
 * state, because the board lives in the agent directory, while `review` is work
 * because it runs the contract's command as a child process in a tree and `land`
 * because it moves the trunk.
 *
 * `subagent` cannot answer it from its hint either, and does not have to: the
 * result reports which mode the child ran in. A read-only child is investigation
 * and a writing child may have changed any file, so its one field answers both of
 * this module's questions — which is why nothing below separates them.
 */
export function isMutatingTool(toolName: string, annotations?: ToolAnnotations, details?: unknown): boolean {
	if (NON_WORK_TOOL_NAMES.has(toolName)) return false;
	if (toolName === BOARD_TOOL) return isBoardWork(details);
	if (toolName === SUBAGENT_TOOL) return isSubagentWork(details);
	if (MUTATING_TOOL_NAMES.has(toolName)) return true;
	return annotations?.readOnlyHint === false;
}

/**
 * Whether a finished tool call can have changed files, as opposed to a shell
 * command that may only have read them. The reminder for a run that never
 * started a list needs this: three `rg` calls are investigation, not unplanned
 * work, and a shell call cannot be told apart from one that wrote. So it is a
 * mutating call that is not a shell — with the call's details passed through,
 * because a board `review` is mutating only when it ran the contract's command
 * in a tree.
 */
export function isFileWrite(toolName: string, annotations?: ToolAnnotations, details?: unknown): boolean {
	if (SHELL_TOOL_NAMES.has(toolName)) return false;
	return isMutatingTool(toolName, annotations, details);
}

/**
 * Successful mutating calls needed before a run with nothing in flight is worth
 * a reminder: no list at all, a cleared one, or one whose items are all
 * completed. A plan that was never started has no item to fall behind, and
 * neither has a closed list until the work adds one, and a false positive costs
 * a whole extra model request — so one edit is not enough evidence that the work
 * needed a list.
 */
export const IDLE_LIST_MUTATIONS = 3;

/** What the current turn knows about its work and the list. */
export interface NudgeState {
	/** Successful mutating calls since the turn began or the list was last written. */
	mutations: number;
	/** How many of those can change files, as opposed to a shell command that may have read. */
	writes: number;
	/** Whether the model wrote or cleared the list since the turn began. */
	touched: boolean;
	/** Whether a reminder was already sent this turn. */
	nudged: boolean;
	/** The current list. */
	todos: Todo[];
}

/**
 * Whether a reminder is due. With an unfinished item, one mutation is enough.
 * With nothing in flight, the turn must also have written something: repeated
 * inspection with no file change is not unplanned work. A list the model wrote
 * or cleared this turn is its own answer, so an explicit clear is never
 * second-guessed.
 */
export function shouldNudge({ mutations, writes, touched, nudged, todos }: NudgeState): boolean {
	if (nudged || mutations <= 0) return false;
	if (hasOpenTodos(todos)) return true;
	return !touched && writes > 0 && mutations >= IDLE_LIST_MUTATIONS;
}

/**
 * Marker on the injected reminder, so it is recognizable and filterable.
 *
 * allow:todo the marker is text the model reads, not a to-do for a human.
 */
export const TODO_NUDGE_MARKER = "[TODO SYNC]";

/**
 * Model-facing reminder injected before settlement. For a list with unfinished
 * work it points at the item the list currently considers active, so the model
 * can correct it without rereading the whole list; with nothing in flight it asks
 * for one — the steps of this work when no list was ever recorded, or an item for
 * work that carried on after the list was closed.
 */
export function formatNudge(todos: Todo[]): string {
	if (!hasOpenTodos(todos)) {
		if (todos.length === 0) {
			return (
				`${TODO_NUDGE_MARKER} Work happened but no todo list was recorded. ` +
				"Call the todo tool with the steps of this work, then continue."
			);
		}
		return (
			`${TODO_NUDGE_MARKER} Work happened after the todo list was closed, every item on it completed. ` +
			"Call the todo tool to record the new work as an item and set it in_progress, then continue."
		);
	}
	// `hasOpenTodos` sent us here, so there is an item the list can point at.
	const current = currentTodo(todos) as Todo;
	return (
		`${TODO_NUDGE_MARKER} Work happened since the todo list was last updated, but the list still has ` +
		`unfinished items. The list still points at "${current.activeForm ?? current.content}". Call the todo ` +
		"tool to mark what is done and set the next item in_progress, then continue."
	);
}

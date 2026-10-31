/**
 * The two nested `todo` writes the plan tools make: seeding a new plan's steps
 * at approval, and mirroring a step update into the items that came from it.
 *
 * The todo list is whole-list replacement, so both go through `todos.ts`'s pure
 * merge/mirror against the list the branch holds, and both report a nested
 * failure in the result rather than becoming error results.
 */

import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { TODO_TOOL } from "../../../lib/tool-names.ts";
import { lastTodos } from "../../../lib/todo-state.ts";
import { elideStep, extractPlanSteps, verificationItem, type PlanStep, type StepUpdate } from "../steps.ts";
import { DEFAULT_TODO_MAX, mergeTodos, mirrorStepStatuses, type TodoMerge } from "../todos.ts";
import { firstTextLine } from "./nested.ts";

/**
 * The todo tool's item cap, read from its registered schema so the merge stops
 * before the nested call would reject the list. Falls back to the documented
 * default when the tool is absent or has not declared one.
 */
function todoMaxItems(pi: ExtensionAPI): number {
	const info = pi.getAllTools().find((tool) => tool.name === TODO_TOOL);
	const parameters = info?.parameters as { properties?: { todos?: { maxItems?: unknown } } } | undefined;
	const max = parameters?.properties?.todos?.maxItems;
	return typeof max === "number" && Number.isInteger(max) && max > 0 ? max : DEFAULT_TODO_MAX;
}

/**
 * Record the plan's steps in the todo list. The list is whole-list replacement,
 * so the steps are merged into what the branch already holds: existing items
 * keep their place and status, duplicates are skipped, and the cap defers the
 * rest. Returns what happened for the approval message.
 */
export async function seedTodos(
	pi: ExtensionAPI,
	ctx: ExtensionToolContext,
	plan: string,
	/** What an earlier approval of the same plan appended, when it was approved before. */
	previous?: readonly string[],
): Promise<{ steps: PlanStep[]; merged?: TodoMerge; error?: string }> {
	// A todo item is one line, so the plan's own text is shortened here rather than in
	// extraction: the file and the `steps` guard keep the whole step.
	const steps = extractPlanSteps(plan).map((step) => ({ ...step, content: elideStep(step.content) }));
	const verification = verificationItem(plan);
	if (steps.length === 0 && !verification) return { steps };
	const merged = mergeTodos(lastTodos(ctx.sessionManager.getBranch()), steps, todoMaxItems(pi), verification, previous);
	// Nothing new to write: every step (and the verification item) is already in
	// the list, or the list is full, so a rewrite would only churn the widget.
	if (merged.added === 0 && merged.trailing !== "added" && merged.replaced === 0) return { steps, merged };
	const outcome = await ctx.executeTool(TODO_TOOL, { todos: merged.todos });
	if (!outcome.isError) return { steps, merged };
	// The nested call fails both when the tool is unavailable and when it rejects
	// the steps; surface its first line so the caller reports the real reason.
	return { steps, merged, error: firstTextLine(outcome) };
}

/**
 * Bring the todo items seeded at approval in line with the batch, and describe
 * what happened for the result text.
 *
 * The plan file is authoritative and has already been written, so a nested
 * failure is reported in the result instead of becoming an error result: once
 * one of the two artifacts changed there is no previous state to hand back.
 * Nothing is written when no item changed, so a repeated call does not churn the
 * widget.
 */
export async function mirrorTodos(ctx: ExtensionToolContext, updates: readonly StepUpdate[]): Promise<string> {
	const mirror = mirrorStepStatuses(lastTodos(ctx.sessionManager.getBranch()), updates);
	if (mirror.updated === 0) {
		if (mirror.unmatched === 0) return "";
		const steps = mirror.unmatched === 1 ? "1 step has" : `${mirror.unmatched} steps have`;
		return `; ${steps} no matching todo item`;
	}
	const items = mirror.updated === 1 ? "1 todo item" : `${mirror.updated} todo items`;
	const outcome = await ctx.executeTool(TODO_TOOL, { todos: mirror.todos });
	if (!outcome.isError) return `; ${items} updated`;
	const firstLine = firstTextLine(outcome);
	return `; could not update ${items} in the todo list${firstLine ? `: ${firstLine}` : ""}`;
}

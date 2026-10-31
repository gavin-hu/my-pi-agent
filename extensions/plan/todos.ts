/**
 * The plan↔todo bridge (pure).
 *
 * `todo` is whole-list replacement, so seeding an approved plan straight over
 * the list would discard whatever the user was already tracking. This module
 * merges the plan's steps into the list `lib/todo-state.ts` replays from the
 * session branch: existing items keep their place and status, a step whose text
 * is already present is skipped, and the tool's item cap is respected without
 * dropping anything the user had. It also mirrors a step's new state back onto
 * the item it seeded, so ticking the plan file keeps the list honest.
 */

import type { ExistingTodo } from "../../lib/todo-state.ts";
import type { PlanStep, StepUpdate } from "./steps.ts";

/** The merged list plus the counts the approval message reports. */
export interface TodoMerge {
	todos: ExistingTodo[];
	/** Plan steps appended to the list. */
	added: number;
	/** Plan steps already in the list (same normalized text). */
	skipped: number;
	/** Existing items kept as they were. */
	kept: number;
	/**
	 * Untouched items dropped because they were seeded by an earlier approval of this
	 * plan and are no longer one of its steps: the plan was renamed or rewritten.
	 */
	replaced: number;
	/**
	 * Older seeds kept because someone had already started or finished them. Deleting one
	 * would erase work a reader did, so they are reported instead of replaced.
	 */
	stale: number;
	/** Plan steps left out because the list reached its cap. */
	deferred: number;
	/**
	 * What happened to the trailing checklist item (the plan's verification
	 * summary): appended after the steps, already present, or left out by the cap.
	 */
	trailing?: "added" | "skipped" | "deferred";
}

/** Fallback list cap when the registered todo tool does not advertise one. */
export const DEFAULT_TODO_MAX = 50;

/** What the tick-time mirror did for one `steps` batch. */
export interface TodoMirror {
	/** The list after the matching items were brought in line with the plan. */
	todos: ExistingTodo[];
	/** Items whose status the batch changed. */
	updated: number;
	/** Steps in the batch with no matching item, so nothing was written for them. */
	unmatched: number;
}

/**
 * Bring the todo items seeded at approval in line with the plan's new step
 * statuses.
 *
 * Matching is on the text the approval seeded, so an item the user renamed is
 * left alone and counted as unmatched rather than overwritten. Only `status`
 * changes, and the last update for a step number wins, the same rule the plan
 * file's own edit follows. An update that changes nothing is not counted, so a
 * refused or repeated call does not churn the widget.
 */
export function mirrorStepStatuses(existing: ExistingTodo[], updates: readonly StepUpdate[]): TodoMirror {
	const byStep = new Map<number, StepUpdate>();
	for (const update of updates) byStep.set(update.step, update);
	const todos = existing.map((todo) => ({ ...todo }));
	let updated = 0;
	let unmatched = 0;
	for (const update of byStep.values()) {
		const index = todos.findIndex((todo) => contentKey(todo.content) === contentKey(update.expected));
		if (index === -1) {
			unmatched += 1;
			continue;
		}
		const todo = todos[index];
		if (todo === undefined || todo.status === update.status) continue;
		todos[index] = { ...todo, status: update.status };
		updated += 1;
	}
	return { todos, updated, unmatched };
}

/** Case- and whitespace-insensitive key for recognizing a repeated item. */
function contentKey(content: string): string {
	return content.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Merge the plan's steps into an existing list. Existing items come first and
 * keep their status, a legacy in-progress item without an `activeForm` gets its
 * content as one so the todo tool accepts it, and the appended steps stop at
 * `max` items — the rest are counted as deferred, never dropped.
 *
 * `trailing` is the plan's verification summary: it is appended after every step
 * (still subject to the same duplicate and cap rules) but is not counted as a
 * step, because it is not one.
 */
export function mergeTodos(
	existing: ExistingTodo[],
	steps: PlanStep[],
	max: number,
	trailing?: PlanStep,
	/** What an earlier approval of this plan seeded, when there was one. */
	previous?: readonly string[],
): TodoMerge {
	const limit = Number.isInteger(max) && max > 0 ? max : DEFAULT_TODO_MAX;
	// A plan refined after approval is approved again over the list its first approval
	// made. An item this plan seeded that is no longer one of its steps is a leftover, and
	// only an item *this plan seeded* is a candidate: a user's own item is never touched.
	const ours = new Set((previous ?? []).map(contentKey));
	const current = new Set(steps.map((step) => contentKey(step.content)));
	if (trailing) current.add(contentKey(trailing.content));
	let replaced = 0;
	let stale = 0;
	const kept: ExistingTodo[] = [];
	for (const todo of existing) {
		const key = contentKey(todo.content);
		if (ours.has(key) && !current.has(key)) {
			// An untouched leftover is bookkeeping and goes; one someone acted on is
			// evidence of work, and is named rather than deleted.
			if (todo.status === "pending") {
				replaced += 1;
				continue;
			}
			stale += 1;
		}
		kept.push(todo);
	}
	const todos: ExistingTodo[] = kept.map((todo) =>
		todo.status === "in_progress" && !todo.activeForm ? { ...todo, activeForm: todo.content } : todo,
	);
	const seen = new Set(todos.map((todo) => contentKey(todo.content)));
	let added = 0;
	let skipped = 0;
	let deferred = 0;
	for (const step of steps) {
		const key = contentKey(step.content);
		if (!key) continue;
		if (seen.has(key)) {
			skipped += 1;
			continue;
		}
		if (todos.length >= limit) {
			deferred += 1;
			continue;
		}
		seen.add(key);
		todos.push({ content: step.content, status: step.status });
		added += 1;
	}

	let trailingOutcome: TodoMerge["trailing"];
	if (trailing) {
		const key = contentKey(trailing.content);
		if (!key) trailingOutcome = undefined;
		else if (seen.has(key)) trailingOutcome = "skipped";
		else if (todos.length >= limit) trailingOutcome = "deferred";
		else {
			todos.push({ content: trailing.content, status: trailing.status });
			trailingOutcome = "added";
		}
	}

	return {
		todos,
		added,
		skipped,
		kept: existing.length - replaced,
		replaced,
		stale,
		deferred,
		trailing: trailingOutcome,
	};
}

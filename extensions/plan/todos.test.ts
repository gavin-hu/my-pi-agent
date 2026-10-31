/**
 * The plan↔todo bridge: what an approval seeds, and how a ticked step reaches the item it
 * seeded.
 *
 * The plan numbers one step per item it lists; the todo list holds one item per distinct
 * text, because a checkbox list of one-liners is not the place to read the same sentence
 * twice. These cases are the whole of that difference.
 */

import { describe, expect, test } from "bun:test";
import type { ExistingTodo } from "../../lib/todo-state.ts";
import { MAX_STEP_LENGTH } from "./steps.ts";
import { DEFAULT_TODO_MAX, mergeTodos, mirrorStepStatuses } from "./todos.ts";

describe("plan approval merge", () => {
	const step = (content: string, status: "pending" | "completed" = "pending") => ({ content, status });

	const existing: ExistingTodo[] = [
		{ content: "Update CHANGELOG", status: "completed" },
		{ content: "Fix the flaky test", status: "pending" },
	];

	test("keeps existing items and appends the plan's steps", () => {
		const merged = mergeTodos(existing, [step("Add a token bucket"), step("Wire the limiter")], DEFAULT_TODO_MAX);
		expect(merged.todos).toEqual([
			{ content: "Update CHANGELOG", status: "completed" },
			{ content: "Fix the flaky test", status: "pending" },
			{ content: "Add a token bucket", status: "pending" },
			{ content: "Wire the limiter", status: "pending" },
		]);
		expect(merged).toMatchObject({ added: 2, skipped: 0, kept: 2, deferred: 0 });
	});

	test("skips a step already in the list regardless of case and spacing", () => {
		const merged = mergeTodos(
			existing,
			[step("  fix   the FLAKY test "), step("Add a token bucket")],
			DEFAULT_TODO_MAX,
		);
		expect(merged.added).toBe(1);
		expect(merged.skipped).toBe(1);
		expect(merged.todos.map((todo) => todo.content)).toEqual([
			"Update CHANGELOG",
			"Fix the flaky test",
			"Add a token bucket",
		]);
	});

	test("keeps an existing status rather than the step's", () => {
		const merged = mergeTodos(
			[{ content: "Done already", status: "completed" }],
			[step("Done already")],
			DEFAULT_TODO_MAX,
		);
		expect(merged.todos).toEqual([{ content: "Done already", status: "completed" }]);
		expect(merged).toMatchObject({ added: 0, skipped: 1, kept: 1 });
	});

	test("replaces the leftovers an earlier approval of the same plan seeded", () => {
		// A plan refined after approval is approved again over the list the first approval
		// made: a step it renamed leaves an untouched item behind, and only an item *this
		// plan* seeded is a candidate — the user's own are never touched.
		const afterFirstApproval: ExistingTodo[] = [
			{ content: "Update CHANGELOG", status: "completed" },
			{ content: "Add a token bucket", status: "pending" },
			{ content: "Wire the limiter", status: "pending" },
		];
		const merged = mergeTodos(
			afterFirstApproval,
			[step("Add a token bucket"), step("Wire the limiter into the router")],
			DEFAULT_TODO_MAX,
			undefined,
			["Add a token bucket", "Wire the limiter"],
		);
		expect(merged.todos.map((todo) => todo.content)).toEqual([
			"Update CHANGELOG",
			"Add a token bucket",
			"Wire the limiter into the router",
		]);
		expect(merged).toMatchObject({ replaced: 1, stale: 0, added: 1, skipped: 1 });
	});

	test("leaves a leftover someone started or finished, and says it is stale", () => {
		// Deleting one would erase work a reader did; naming it lets them decide.
		const merged = mergeTodos(
			[
				{ content: "Wire the limiter", status: "completed" },
				{ content: "Add a token bucket", status: "in_progress", activeForm: "Adding a token bucket" },
			],
			[step("Wire the limiter into the router")],
			DEFAULT_TODO_MAX,
			undefined,
			["Wire the limiter", "Add a token bucket"],
		);
		expect(merged.todos.map((todo) => todo.content)).toEqual([
			"Wire the limiter",
			"Add a token bucket",
			"Wire the limiter into the router",
		]);
		expect(merged).toMatchObject({ replaced: 0, stale: 2, added: 1 });
	});

	test("appends the plan's verification summary after the steps, not as a step", () => {
		const merged = mergeTodos([{ content: "Halfway", status: "in_progress" }], [], DEFAULT_TODO_MAX);
		expect(merged.todos).toEqual([{ content: "Halfway", status: "in_progress", activeForm: "Halfway" }]);
	});

	test("defers steps beyond the cap without dropping existing items", () => {
		const full: ExistingTodo[] = Array.from({ length: DEFAULT_TODO_MAX }, (_, index) => ({
			content: `Existing ${index}`,
			status: "pending" as const,
		}));
		const merged = mergeTodos(full, [step("Extra one"), step("Extra two")], DEFAULT_TODO_MAX);
		expect(merged.todos).toHaveLength(DEFAULT_TODO_MAX);
		expect(merged).toMatchObject({ added: 0, skipped: 0, kept: DEFAULT_TODO_MAX, deferred: 2 });
	});

	test("appends what fits when the list is nearly full", () => {
		const nearlyFull: ExistingTodo[] = Array.from({ length: DEFAULT_TODO_MAX - 1 }, (_, index) => ({
			content: `Existing ${index}`,
			status: "pending" as const,
		}));
		const merged = mergeTodos(nearlyFull, [step("Fits"), step("Overflow")], DEFAULT_TODO_MAX);
		expect(merged).toMatchObject({ added: 1, deferred: 1 });
		expect(merged.todos.at(-1)?.content).toBe("Fits");
	});

	test("seeds the steps into an empty list", () => {
		const merged = mergeTodos([], [step("First"), step("Second", "completed")], DEFAULT_TODO_MAX);
		expect(merged.todos).toEqual([
			{ content: "First", status: "pending" },
			{ content: "Second", status: "completed" },
		]);
		expect(merged).toMatchObject({ added: 2, skipped: 0, kept: 0, deferred: 0 });
	});

	test("appends the verification item after the steps without counting it as one", () => {
		const steps = [{ content: "Add the cache", status: "pending" as const }];
		const verification = { content: "Verify: bun run check passes", status: "pending" as const };
		const merged = mergeTodos([], steps, 50, verification);

		expect(merged.todos.map((todo) => todo.content)).toEqual(["Add the cache", "Verify: bun run check passes"]);
		expect(merged.added).toBe(1);
		expect(merged.trailing).toBe("added");
	});

	test("skips a verification item the list already holds", () => {
		const verification = { content: "Verify: bun run check passes", status: "pending" as const };
		const merged = mergeTodos([verification], [step("Add the cache")], 50, verification);
		expect(merged.trailing).toBe("skipped");
		expect(merged.todos.filter((todo) => todo.content === verification.content)).toHaveLength(1);
	});

	test("defers a verification item when the list is full, after the steps fit", () => {
		const verification = { content: "Verify: bun run check passes", status: "pending" as const };
		const merged = mergeTodos([{ content: "existing", status: "pending" }], [step("Add the cache")], 2, verification);
		expect(merged.todos.map((todo) => todo.content)).toEqual(["existing", "Add the cache"]);
		expect(merged.trailing).toBe("deferred");
		expect(merged.deferred).toBe(0);
		expect(mergeTodos([], [step("Add the cache")], 50).trailing).toBeUndefined();
	});

	const list: ExistingTodo[] = [
		{ content: "One", status: "pending" },
		{ content: "Two", status: "in_progress", activeForm: "Doing two" },
	];

	test("mirror ticks the matching item and leaves the rest untouched", () => {
		const mirror = mirrorStepStatuses(list, [{ step: 1, status: "completed", expected: "One" }]);

		expect(mirror.todos).toEqual([
			{ content: "One", status: "completed" },
			{ content: "Two", status: "in_progress", activeForm: "Doing two" },
		]);
		expect(mirror).toMatchObject({ updated: 1, unmatched: 0 });
	});

	test("mirror reopens a completed item, matching regardless of case and spacing", () => {
		const mirror = mirrorStepStatuses(
			[{ content: "One", status: "completed" }],
			[{ step: 1, status: "pending", expected: "  one " }],
		);

		expect(mirror.todos).toEqual([{ content: "One", status: "pending" }]);
		expect(mirror.updated).toBe(1);
	});

	test("mirror counts an unmatched step instead of inventing an item", () => {
		const mirror = mirrorStepStatuses(list, [{ step: 2, status: "completed", expected: "Renamed" }]);

		expect(mirror.todos).toEqual(list);
		expect(mirror).toMatchObject({ updated: 0, unmatched: 1 });
	});

	test("mirror does not count an item already in the requested state", () => {
		const mirror = mirrorStepStatuses(
			[{ content: "One", status: "completed" }],
			[{ step: 1, status: "completed", expected: "One" }],
		);

		expect(mirror).toMatchObject({ updated: 0, unmatched: 0 });
	});

	test("mirror lets the last update for a step number win", () => {
		const mirror = mirrorStepStatuses(
			[{ content: "One", status: "pending" }],
			[
				{ step: 1, status: "completed", expected: "One" },
				{ step: 1, status: "pending", expected: "One" },
			],
		);

		expect(mirror.updated).toBe(0);
		expect(mirror.todos[0]?.status).toBe("pending");
	});

	test("mirror matches an elided step to the elided text approval seeded", () => {
		const elided = `${"x".repeat(MAX_STEP_LENGTH - 1)}…`;
		const mirror = mirrorStepStatuses(
			[{ content: elided, status: "pending" }],
			[{ step: 1, status: "completed", expected: elided }],
		);

		expect(mirror.todos).toEqual([{ content: elided, status: "completed" }]);
		expect(mirror.updated).toBe(1);
	});

	test("mirror does not alias the list it was given", () => {
		const input: ExistingTodo[] = [{ content: "One", status: "pending" }];
		const mirror = mirrorStepStatuses(input, [{ step: 1, status: "completed", expected: "One" }]);

		expect(input[0]?.status).toBe("pending");
		expect(mirror.todos[0]?.status).toBe("completed");
	});

	test("mirrors two identical steps onto the one row they share", () => {
		// The plan numbers them 1 and 2 and the todo list holds the text once, so ticking
		// either step has to land on that row: the repeated step is one task, not two.
		const merged = mergeTodos([], [step("Add tests"), step("Add tests")], DEFAULT_TODO_MAX);
		expect(merged).toMatchObject({ added: 1, skipped: 1 });
		const mirror = mirrorStepStatuses(merged.todos, [{ step: 2, status: "completed", expected: "Add tests" }]);
		expect(mirror.todos).toEqual([{ content: "Add tests", status: "completed" }]);
		expect(mirror).toMatchObject({ updated: 1, unmatched: 0 });
	});
});

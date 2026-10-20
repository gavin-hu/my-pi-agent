import { describe, expect, test } from "bun:test";
import type { ExistingTodo } from "../../lib/todo-state.ts";
import { MAX_STEP_LENGTH } from "./steps.ts";
import { DEFAULT_TODO_MAX, mergeTodos, mirrorStepStatuses } from "./todos.ts";

const step = (content: string, status: "pending" | "completed" = "pending") => ({ content, status });

describe("mergeTodos", () => {
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

	test("fills activeForm for a legacy in-progress item", () => {
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
});

describe("mergeTodos — the trailing verification item", () => {
	const steps = [{ content: "Add the cache", status: "pending" as const }];
	const verification = { content: "Verify: bun run check passes", status: "pending" as const };

	test("appends it after the steps without counting it as one", () => {
		const merged = mergeTodos([], steps, 50, verification);

		expect(merged.todos.map((todo) => todo.content)).toEqual(["Add the cache", "Verify: bun run check passes"]);
		expect(merged.added).toBe(1);
		expect(merged.trailing).toBe("added");
	});

	test("skips it when the list already holds it", () => {
		const merged = mergeTodos([verification], steps, 50, verification);
		expect(merged.trailing).toBe("skipped");
		expect(merged.todos.filter((todo) => todo.content === verification.content)).toHaveLength(1);
	});

	test("defers it when the list is full, after the steps fit", () => {
		const merged = mergeTodos([{ content: "existing", status: "pending" }], steps, 2, verification);
		expect(merged.todos.map((todo) => todo.content)).toEqual(["existing", "Add the cache"]);
		expect(merged.trailing).toBe("deferred");
		expect(merged.deferred).toBe(0);
	});

	test("reports nothing when the plan has no verification item", () => {
		expect(mergeTodos([], steps, 50).trailing).toBeUndefined();
	});
});

describe("mirrorStepStatuses", () => {
	const list: ExistingTodo[] = [
		{ content: "One", status: "pending" },
		{ content: "Two", status: "in_progress", activeForm: "Doing two" },
	];

	test("ticks the matching item and leaves the rest untouched", () => {
		const mirror = mirrorStepStatuses(list, [{ step: 1, status: "completed", expected: "One" }]);

		expect(mirror.todos).toEqual([
			{ content: "One", status: "completed" },
			{ content: "Two", status: "in_progress", activeForm: "Doing two" },
		]);
		expect(mirror).toMatchObject({ updated: 1, unmatched: 0 });
	});

	test("reopens a completed item, matching regardless of case and spacing", () => {
		const mirror = mirrorStepStatuses(
			[{ content: "One", status: "completed" }],
			[{ step: 1, status: "pending", expected: "  one " }],
		);

		expect(mirror.todos).toEqual([{ content: "One", status: "pending" }]);
		expect(mirror.updated).toBe(1);
	});

	test("counts an unmatched step instead of inventing an item", () => {
		const mirror = mirrorStepStatuses(list, [{ step: 2, status: "completed", expected: "Renamed" }]);

		expect(mirror.todos).toEqual(list);
		expect(mirror).toMatchObject({ updated: 0, unmatched: 1 });
	});

	test("does not count an item that is already in the requested state", () => {
		const mirror = mirrorStepStatuses(
			[{ content: "One", status: "completed" }],
			[{ step: 1, status: "completed", expected: "One" }],
		);

		expect(mirror).toMatchObject({ updated: 0, unmatched: 0 });
	});

	test("the last update for a step number wins", () => {
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

	test("matches an elided step to the elided text approval seeded", () => {
		const elided = `${"x".repeat(MAX_STEP_LENGTH - 1)}…`;
		const mirror = mirrorStepStatuses(
			[{ content: elided, status: "pending" }],
			[{ step: 1, status: "completed", expected: elided }],
		);

		expect(mirror.todos).toEqual([{ content: elided, status: "completed" }]);
		expect(mirror.updated).toBe(1);
	});

	test("does not alias the list it was given", () => {
		const input: ExistingTodo[] = [{ content: "One", status: "pending" }];
		const mirror = mirrorStepStatuses(input, [{ step: 1, status: "completed", expected: "One" }]);

		expect(input[0]?.status).toBe("pending");
		expect(mirror.todos[0]?.status).toBe("completed");
	});
});

import { describe, expect, test } from "bun:test";
import type { ExistingTodo } from "../../lib/todo-state.ts";
import { DEFAULT_TODO_MAX, mergeTodos } from "./todos.ts";

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

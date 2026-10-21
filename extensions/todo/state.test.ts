import { describe, expect, test } from "bun:test";
import { completedCount, currentTodo, hasOpenTodos } from "./state.ts";
import type { Todo } from "./types.ts";

const pending = (content: string): Todo => ({ content, status: "pending" });
const done = (content: string): Todo => ({ content, status: "completed" });
const active = (content: string): Todo => ({ content, status: "in_progress" });

describe("query helpers", () => {
	const todos = [done("a"), active("b"), pending("c")];

	test("completedCount counts completed items", () => {
		expect(completedCount(todos)).toBe(1);
	});

	test("hasOpenTodos is true while anything is unfinished", () => {
		expect(hasOpenTodos(todos)).toBe(true);
		expect(hasOpenTodos([done("a")])).toBe(false);
		expect(hasOpenTodos([])).toBe(false);
	});

	test("currentTodo prefers in_progress, then the first pending", () => {
		expect(currentTodo(todos)).toEqual(active("b"));
		expect(currentTodo([done("a"), pending("c"), pending("d")])).toEqual(pending("c"));
		expect(currentTodo([done("a")])).toBeUndefined();
	});
});

import { describe, expect, test } from "bun:test";
import {
	completedCount,
	countByStatus,
	currentTodo,
	hasOpenTodos,
	reconstructTodos,
} from "../../extensions/todo/state.ts";
import type { Todo } from "../../extensions/todo/types.ts";
import { resultEntry } from "./helpers.ts";

const pending = (content: string): Todo => ({ content, status: "pending" });
const done = (content: string): Todo => ({ content, status: "completed" });
const active = (content: string): Todo => ({ content, status: "in_progress" });

/** A raw `todo` result entry, for malformed/error details the helper cannot build. */
const rawEntry = (details: unknown): unknown => ({
	type: "message",
	message: { role: "toolResult", toolName: "todo", details },
});

describe("reconstructTodos", () => {
	test("returns an empty list for an empty branch", () => {
		expect(reconstructTodos([])).toEqual([]);
	});

	test("uses the last list written on the branch", () => {
		const entries = [
			resultEntry([pending("one")]),
			{ type: "message", message: { role: "assistant", content: "ok" } },
			resultEntry([done("one"), active("two")]),
		];
		expect(reconstructTodos(entries)).toEqual([done("one"), active("two")]);
	});

	test("ignores results from other tools", () => {
		const entries = [resultEntry([pending("mine")]), resultEntry([pending("theirs")], "bash")];
		expect(reconstructTodos(entries)).toEqual([pending("mine")]);
	});

	test("a clear (empty list) resets state", () => {
		expect(reconstructTodos([resultEntry([pending("one")]), resultEntry([])])).toEqual([]);
	});

	test("ignores non-message and malformed entries", () => {
		const entries = [
			{ type: "label", targetId: "x" },
			{ type: "message", message: { role: "toolResult", toolName: "todo", details: {} } },
			resultEntry([pending("kept")]),
			null,
		];
		expect(reconstructTodos(entries)).toEqual([pending("kept")]);
	});

	test("ignores a malformed stored list instead of throwing", () => {
		const entries = [resultEntry([pending("kept")]), rawEntry({ todos: [null], action: "write" })];
		expect(reconstructTodos(entries)).toEqual([pending("kept")]);
	});

	test("ignores an entry with an invalid status", () => {
		const entries = [
			resultEntry([pending("kept")]),
			rawEntry({ todos: [{ content: "bad", status: "bogus" }], action: "write" }),
		];
		expect(reconstructTodos(entries)).toEqual([pending("kept")]);
	});

	test("does not replay a rejected call as a state write", () => {
		const entries = [
			resultEntry([pending("kept")]),
			rawEntry({ todos: [pending("other")], action: "write", error: "boom" }),
		];
		expect(reconstructTodos(entries)).toEqual([pending("kept")]);
	});

	test("re-sanitizes stored content to one safe line", () => {
		const entries = [resultEntry([{ content: "line one\nline two", status: "pending" } as Todo])];
		const [todo] = reconstructTodos(entries);
		expect(todo.content).toBe("line one line two");
		expect(todo.content).not.toContain("\u001b");
	});

	test("does not alias the stored list", () => {
		const stored = [pending("one")];
		const result = reconstructTodos([resultEntry(stored)]);
		result[0].content = "mutated";
		expect(stored[0].content).toBe("one");
	});
});

describe("query helpers", () => {
	const todos = [done("a"), active("b"), pending("c")];

	test("countByStatus tallies each status", () => {
		expect(countByStatus(todos)).toEqual({ pending: 1, in_progress: 1, completed: 1 });
	});

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

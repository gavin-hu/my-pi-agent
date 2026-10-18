import { describe, expect, test } from "bun:test";
import { lastTodos } from "./todo-state.ts";

/** A session entry carrying one todo tool result. */
function todoResult(todos: unknown, error?: string): unknown {
	return {
		type: "message",
		message: {
			role: "toolResult",
			toolName: "todo",
			details: error === undefined ? { todos, action: "write" } : { todos, action: "write", error },
		},
	};
}

describe("lastTodos", () => {
	test("returns the last list written on the branch", () => {
		const entries = [
			todoResult([{ content: "One", status: "pending" }]),
			todoResult([{ content: "Two", status: "completed" }]),
		];
		expect(lastTodos(entries)).toEqual([{ content: "Two", status: "completed" }]);
	});

	test("a rejected call does not change the list", () => {
		const entries = [
			todoResult([{ content: "Kept", status: "pending" }]),
			todoResult([{ content: "Ignored", status: "pending" }], "too many"),
		];
		expect(lastTodos(entries)).toEqual([{ content: "Kept", status: "pending" }]);
	});

	test("a malformed entry does not wipe a valid list", () => {
		const entries = [
			todoResult([{ content: "Kept", status: "pending" }]),
			todoResult("not a list"),
			{ type: "message", message: { role: "toolResult", toolName: "todo", details: null } },
		];
		expect(lastTodos(entries)).toEqual([{ content: "Kept", status: "pending" }]);
	});

	test("drops items that do not validate and trims content", () => {
		const entries = [
			todoResult([
				{ content: "  Padded  ", status: "in_progress", activeForm: " Doing it " },
				{ content: "", status: "pending" },
				{ content: 42, status: "pending" },
				{ content: "Bad status", status: "doing" },
				{ content: "No activeForm", status: "in_progress" },
			]),
		];
		expect(lastTodos(entries)).toEqual([
			{ content: "Padded", status: "in_progress", activeForm: "Doing it" },
			{ content: "No activeForm", status: "in_progress" },
		]);
	});

	test("returns an empty list for an unrelated branch", () => {
		expect(lastTodos([])).toEqual([]);
		expect(lastTodos([{ type: "message", message: { role: "toolResult", toolName: "read", details: {} } }])).toEqual(
			[],
		);
	});
});

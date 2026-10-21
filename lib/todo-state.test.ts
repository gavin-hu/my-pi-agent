import { describe, expect, test } from "bun:test";
import { lastTodos, MAX_CONTENT, MAX_TODOS, normalizeTodos } from "./todo-state.ts";

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

describe("normalizeTodos", () => {
	test("treats missing input as an empty list", () => {
		expect(normalizeTodos(undefined)).toEqual([]);
		expect(normalizeTodos(null)).toEqual([]);
		expect(normalizeTodos([])).toEqual([]);
	});

	test("keeps content and status, trimming content", () => {
		expect(normalizeTodos([{ content: "  Write tests  ", status: "pending" }])).toEqual([
			{ content: "Write tests", status: "pending" },
		]);
	});

	test("collapses whitespace runs so content stays on one line", () => {
		expect(normalizeTodos([{ content: "first\nsecond\tthird  fourth", status: "pending" }])).toEqual([
			{ content: "first second third fourth", status: "pending" },
		]);
	});

	test("strips control characters that could corrupt the terminal", () => {
		const [todo] = normalizeTodos([{ content: "safe\u001b[31mRED\u0007", status: "pending" }]);
		expect(todo.content).toBe("safe [31mRED");
	});

	test("rejects content that is only whitespace or control characters", () => {
		expect(() => normalizeTodos([{ content: "\n\t\u001b\u0007", status: "pending" }])).toThrow("content is required");
	});

	test("keeps a non-blank activeForm and drops a blank one", () => {
		const [withForm, withoutForm] = normalizeTodos([
			{ content: "Run tests", status: "in_progress", activeForm: "  Running tests  " },
			{ content: "Ship it", status: "pending", activeForm: "   " },
		]);
		expect(withForm.activeForm).toBe("Running tests");
		expect(withoutForm.activeForm).toBeUndefined();
	});

	test("sanitizes activeForm like content", () => {
		const [todo] = normalizeTodos([
			{ content: "Run tests", status: "in_progress", activeForm: "Running\ntests\u001b[0m" },
		]);
		expect(todo.activeForm).toBe("Running tests [0m");
	});

	test("drops an activeForm made only of control characters", () => {
		const [todo] = normalizeTodos([{ content: "Run tests", status: "pending", activeForm: "\u001b\u0007" }]);
		expect(todo.activeForm).toBeUndefined();
	});

	test("rejects an in_progress item without an activeForm", () => {
		expect(() => normalizeTodos([{ content: "Run tests", status: "in_progress" }])).toThrow("activeForm is required");
		expect(() => normalizeTodos([{ content: "Run tests", status: "in_progress", activeForm: "   " }])).toThrow(
			"activeForm is required",
		);
	});

	test("rejects an over-long activeForm", () => {
		expect(() =>
			normalizeTodos([{ content: "Run tests", status: "in_progress", activeForm: "x".repeat(MAX_CONTENT + 1) }]),
		).toThrow(`activeForm is longer than ${MAX_CONTENT}`);
	});

	test("can accept a legacy in_progress item without an activeForm", () => {
		expect(normalizeTodos([{ content: "Run tests", status: "in_progress" }], { requireActiveForm: false })).toEqual([
			{ content: "Run tests", status: "in_progress" },
		]);
	});

	test("accepts a status in any case", () => {
		expect(normalizeTodos([{ content: "A", status: "IN_PROGRESS", activeForm: "Doing A" }])[0].status).toBe(
			"in_progress",
		);
	});

	test("allows a single in_progress item", () => {
		const todos = normalizeTodos([
			{ content: "A", status: "completed" },
			{ content: "B", status: "in_progress", activeForm: "Doing B" },
			{ content: "C", status: "pending" },
		]);
		expect(todos).toHaveLength(3);
	});

	test("rejects more than one in_progress item", () => {
		expect(() =>
			normalizeTodos([
				{ content: "A", status: "in_progress", activeForm: "Doing A" },
				{ content: "B", status: "in_progress", activeForm: "Doing B" },
			]),
		).toThrow("At most one todo may be in_progress");
	});

	test("rejects duplicate content case-insensitively", () => {
		expect(() =>
			normalizeTodos([
				{ content: "Write tests", status: "pending" },
				{ content: "write TESTS", status: "pending" },
			]),
		).toThrow("duplicate content");
	});

	test("rejects a missing description", () => {
		expect(() => normalizeTodos([{ content: "   ", status: "pending" }])).toThrow("content is required");
	});

	test("rejects an unknown status", () => {
		expect(() => normalizeTodos([{ content: "A", status: "blocked" }])).toThrow("status must be one of");
	});

	test("rejects over-long content", () => {
		expect(() => normalizeTodos([{ content: "x".repeat(MAX_CONTENT + 1), status: "pending" }])).toThrow(
			`longer than ${MAX_CONTENT}`,
		);
	});

	test("rejects too many items", () => {
		const items = Array.from({ length: MAX_TODOS + 1 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
		expect(() => normalizeTodos(items)).toThrow(`At most ${MAX_TODOS}`);
	});

	test("rejects a non-array", () => {
		expect(() => normalizeTodos("nope")).toThrow("todos must be an array");
	});
});

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

	test("ignores a write with one invalid item instead of partially applying it", () => {
		const entries = [
			todoResult([{ content: "Kept", status: "pending" }]),
			todoResult([
				{ content: "Valid", status: "pending" },
				{ content: "", status: "pending" },
			]),
		];
		expect(lastTodos(entries)).toEqual([{ content: "Kept", status: "pending" }]);
	});

	test("ignores a write with two in_progress items", () => {
		const entries = [
			todoResult([{ content: "Kept", status: "pending" }]),
			todoResult([
				{ content: "A", status: "in_progress", activeForm: "Doing A" },
				{ content: "B", status: "in_progress", activeForm: "Doing B" },
			]),
		];
		expect(lastTodos(entries)).toEqual([{ content: "Kept", status: "pending" }]);
	});

	test("a clear (empty list) resets state", () => {
		expect(lastTodos([todoResult([{ content: "One", status: "pending" }]), todoResult([])])).toEqual([]);
	});

	test("ignores results from other tools", () => {
		const entries = [
			todoResult([{ content: "Mine", status: "pending" }]),
			{ type: "message", message: { role: "toolResult", toolName: "bash", details: { todos: [] } } },
		];
		expect(lastTodos(entries)).toEqual([{ content: "Mine", status: "pending" }]);
	});

	test("ignores non-message and malformed entries", () => {
		const entries = [{ type: "label", targetId: "x" }, null, todoResult([{ content: "Kept", status: "pending" }])];
		expect(lastTodos(entries)).toEqual([{ content: "Kept", status: "pending" }]);
	});

	test("trims and sanitizes stored content", () => {
		const entries = [todoResult([{ content: "  line one\nline two  ", status: "pending" }])];
		expect(lastTodos(entries)).toEqual([{ content: "line one line two", status: "pending" }]);
	});

	test("replays a legacy in_progress item without an activeForm", () => {
		const entries = [todoResult([{ content: "Running", status: "in_progress" }])];
		expect(lastTodos(entries)).toEqual([{ content: "Running", status: "in_progress" }]);
	});

	test("does not alias the stored list", () => {
		const stored = [{ content: "one", status: "pending" }];
		const result = lastTodos([todoResult(stored)]);
		result[0].content = "mutated";
		expect(stored[0].content).toBe("one");
	});
});

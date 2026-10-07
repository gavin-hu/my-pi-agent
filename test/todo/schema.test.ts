import { describe, expect, test } from "bun:test";
import { MAX_CONTENT, MAX_TODOS, normalizeTodos } from "../../extensions/todo/schema.ts";

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
		const [todo] = normalizeTodos([{ content: "Run tests", status: "in_progress", activeForm: "\u001b\u0007" }]);
		expect(todo.activeForm).toBeUndefined();
	});

	test("accepts a status in any case", () => {
		expect(normalizeTodos([{ content: "A", status: "IN_PROGRESS" }])[0].status).toBe("in_progress");
	});

	test("allows a single in_progress item", () => {
		const todos = normalizeTodos([
			{ content: "A", status: "completed" },
			{ content: "B", status: "in_progress" },
			{ content: "C", status: "pending" },
		]);
		expect(todos).toHaveLength(3);
	});

	test("rejects more than one in_progress item", () => {
		expect(() =>
			normalizeTodos([
				{ content: "A", status: "in_progress" },
				{ content: "B", status: "in_progress" },
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

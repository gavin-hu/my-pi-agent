import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatCallText, formatTodoList, formatTodoText, progressSummary } from "../../extensions/todo/format.ts";
import type { Todo } from "../../extensions/todo/types.ts";

const todos: Todo[] = [
	{ content: "Write schema", status: "completed" },
	{ content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
	{ content: "Ship it", status: "pending" },
];

describe("todo formatting", () => {
	test("formatTodoList marks each status", () => {
		expect(formatTodoList(todos)).toBe(["1. [x] Write schema", "2. [~] Write tests", "3. [ ] Ship it"].join("\n"));
	});

	test("formatTodoList handles an empty list", () => {
		expect(formatTodoList([])).toBe("No todos.");
	});

	test("progressSummary counts completed items", () => {
		expect(progressSummary(todos)).toBe("1/3 completed");
		expect(progressSummary([])).toBe("No todos");
	});

	test("formatTodoText adds progress and the active item", () => {
		const text = formatTodoText(todos);
		expect(text).toContain("1. [x] Write schema");
		expect(text).toContain("1/3 completed");
		expect(text).toContain("In progress: Writing tests");
	});

	test("formatTodoText reports a cleared list", () => {
		expect(formatTodoText([])).toBe("Todo list cleared.");
	});

	test("formatCallText summarizes the call", () => {
		expect(formatCallText([])).toBe("todo → clear list");
		expect(formatCallText([{ content: "Only" }])).toBe("todo → 1 item: Only");
		expect(formatCallText([{ content: "First" }, { content: "Second" }])).toBe("todo → 2 items: First, …");
		expect(formatCallText(undefined)).toBe("todo → clear list");
	});

	test("formatCallText distinguishes a streaming call from a clear", () => {
		expect(formatCallText(undefined, false)).toBe("todo → …");
		expect(formatCallText([], false)).toBe("todo → clear list");
	});

	test("formatCallText clips a long first item", () => {
		const text = formatCallText([{ content: "x".repeat(80) }]);
		expect(visibleWidth(text)).toBe(visibleWidth("todo → 1 item: ") + 40);
		expect(text.endsWith("…")).toBe(true);
	});
});

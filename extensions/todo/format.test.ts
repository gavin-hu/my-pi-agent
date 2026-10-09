import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { formatCallText, formatTodoList, formatTodoText, progressSummary, todoRailLines } from "./format.ts";
import type { Todo } from "./types.ts";

const todos: Todo[] = [
	{ content: "Write schema", status: "completed" },
	{ content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
	{ content: "Ship it", status: "pending" },
];

describe("todo formatting", () => {
	test("formatTodoList marks each status", () => {
		expect(formatTodoList(todos)).toBe(["1. ✓ Write schema", "2. ◐ Write tests", "3. ○ Ship it"].join("\n"));
	});

	test("formatTodoList handles an empty list", () => {
		expect(formatTodoList([])).toBe("No todos.");
	});

	test("progressSummary counts completed items", () => {
		expect(progressSummary(todos)).toBe("1/3 completed");
		expect(progressSummary([])).toBe("No todos");
	});

	test("formatTodoText returns a compact summary, not the checklist", () => {
		const text = formatTodoText(todos);
		expect(text).toBe("1/3 completed\nIn progress: Writing tests");
		expect(text).not.toContain("Write schema");
	});

	test("formatTodoText reports a cleared list", () => {
		expect(formatTodoText([])).toBe("Todo list cleared.");
	});

	test("formatCallText summarizes the call", () => {
		expect(formatCallText([])).toBe("→ clear list");
		expect(formatCallText([{ content: "Only" }])).toBe("→ 1 item: Only");
		expect(formatCallText([{ content: "First" }, { content: "Second" }])).toBe("→ 2 items: First, …");
		expect(formatCallText(undefined)).toBe("→ clear list");
	});

	test("formatCallText distinguishes a streaming call from a clear", () => {
		expect(formatCallText(undefined, false)).toBe("→ …");
		expect(formatCallText([], false)).toBe("→ clear list");
	});

	test("formatCallText clips a long first item", () => {
		const text = formatCallText([{ content: "x".repeat(80) }]);
		expect(visibleWidth(text)).toBe(visibleWidth("→ 1 item: ") + 40);
		expect(text.endsWith("…")).toBe(true);
	});

	test("formatCallText never exceeds the preview width on wide glyphs", () => {
		const text = formatCallText([{ content: "あ".repeat(39) + "い" }]);
		expect(visibleWidth(text)).toBeLessThanOrEqual(visibleWidth("→ 1 item: ") + 40);
	});
});

describe("todoRailLines", () => {
	test("indents each row and leads it with the status glyph", () => {
		expect(todoRailLines({ all: todos, rows: todos }, fakeTheme, 60)).toEqual([
			"  ✓ Write schema",
			"  ◐ Writing tests",
			"  ○ Ship it",
			"    1/3 completed",
		]);
	});

	test("wraps a long label with continuation rows under the text column", () => {
		const long: Todo[] = [{ content: "x".repeat(40), status: "pending" }];
		const lines = todoRailLines({ all: long, rows: long }, fakeTheme, 20);
		expect(lines[0]).toBe(`  ○ ${"x".repeat(16)}`);
		expect(lines[1]?.startsWith("    ")).toBe(true);
		expect(lines[1]?.trimStart()).not.toContain("○");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
	});

	test("reports capped rows and the progress footer", () => {
		const all: Todo[] = Array.from({ length: 8 }, (_, i) => ({ content: `item ${i}`, status: "pending" as const }));
		const lines = todoRailLines({ all, rows: all.slice(0, 6), more: 2 }, fakeTheme, 60);
		expect(lines.at(-2)).toMatch(/^ {4}… 2 more$/);
		expect(lines.at(-1)).toMatch(/^ {4}0\/8 completed$/);
	});
});

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { TodoListComponent, TodoWidget } from "../../extensions/todo/tui.ts";
import type { Todo } from "../../extensions/todo/types.ts";

/** A theme double whose `fg` is the identity, so text stays assertable. */
const theme: any = { fg: (_color: string, text: string) => text };

const todos: Todo[] = [
	{ content: "Write schema", status: "completed" },
	{ content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
	{ content: "Ship it", status: "pending" },
];

describe("TodoWidget", () => {
	test("shows the summary and each item", () => {
		const lines = new TodoWidget(todos, theme).render(60);
		expect(lines[0]).toContain("Todos");
		expect(lines[0]).toContain("1/3 completed");
		const body = lines.join("\n");
		expect(body).toContain("✓ Write schema");
		expect(body).toContain("◐ Writing tests");
		expect(body).toContain("○ Ship it");
	});

	test("bounds the number of rows", () => {
		const many: Todo[] = Array.from({ length: 9 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
		const body = new TodoWidget(many, theme).render(60).join("\n");
		expect(body).toContain("… 4 more");
	});

	test("never exceeds the available width", () => {
		const lines = new TodoWidget([{ content: "x".repeat(200), status: "pending" }], theme).render(20);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
	});
});

describe("TodoListComponent", () => {
	test("renders an empty-state hint", () => {
		const lines = new TodoListComponent([], theme, () => {}).render(60);
		expect(lines.join("\n")).toContain("No todos yet");
	});

	test("closes on Escape", () => {
		let closed = 0;
		const component = new TodoListComponent(todos, theme, () => closed++);
		component.handleInput("\u001b");
		expect(closed).toBe(1);
		component.handleInput("x");
		expect(closed).toBe(1);
	});
});

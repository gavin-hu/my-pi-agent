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
	test("shows progress and the current item on one line", () => {
		const lines = new TodoWidget(todos, theme).render(60);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toBe("Todos · 1/3 · ◐ Writing tests");
	});

	test("falls back to a completion note when nothing is open", () => {
		const done: Todo[] = todos.map((todo) => ({ ...todo, status: "completed" }));
		expect(new TodoWidget(done, theme).render(60)).toEqual(["Todos · 3/3 completed"]);
	});

	test("renders nothing for an empty list", () => {
		expect(new TodoWidget([], theme).render(60)).toEqual([]);
	});

	test("never exceeds the available width", () => {
		const lines = new TodoWidget([{ content: "x".repeat(200), status: "pending" }], theme).render(20);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
	});
});

describe("TodoListComponent", () => {
	test("renders an empty-state hint", () => {
		const lines = new TodoListComponent([], theme, () => {}, () => {}).render(60);
		expect(lines.join("\n")).toContain("No todos yet");
	});

	test("closes on Escape", () => {
		let closed = 0;
		const component = new TodoListComponent(todos, theme, () => closed++, () => {});
		component.handleInput("\u001b");
		expect(closed).toBe(1);
		component.handleInput("x");
		expect(closed).toBe(1);
	});

	test("keeps the header border within the width", () => {
		const lines = new TodoListComponent(todos, theme, () => {}, () => {}).render(40);
		expect(visibleWidth(lines[0])).toBe(40);
	});

	test("sizes the window to the terminal height", () => {
		const many: Todo[] = Array.from({ length: 30 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));

		const short = new TodoListComponent(many, theme, () => {}, () => {}, 15).render(60).join("\n");
		expect(short).toContain("showing 1–6 of 30");
		expect(short).not.toContain("item 6");

		const tall = new TodoListComponent(many, theme, () => {}, () => {}, 60).render(60).join("\n");
		expect(tall).toContain("showing 1–20 of 30");
	});

	test("drops the title instead of ellipsizing the border when very narrow", () => {
		const lines = new TodoListComponent(todos, theme, () => {}, () => {}).render(6);
		expect(visibleWidth(lines[0])).toBe(6);
		expect(lines[0]).not.toContain("...");
	});

	test("windows long lists and scrolls on demand", () => {
		const many: Todo[] = Array.from({ length: 30 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
		let renders = 0;
		const component = new TodoListComponent(many, theme, () => {}, () => renders++);

		const first = component.render(60).join("\n");
		expect(first).toContain("item 0");
		expect(first).not.toContain("item 12");
		expect(first).toContain("showing 1–12 of 30");

		component.handleInput("\u001b[B"); // down arrow
		expect(renders).toBe(1);
		expect(component.render(60).join("\n")).toContain("showing 2–13 of 30");

		component.handleInput("\u001b[6~"); // page down
		expect(component.render(60).join("\n")).toContain("item 13");
	});
});

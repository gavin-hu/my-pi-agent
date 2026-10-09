import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { TodoListComponent, TodoResult, TodoWidget } from "./tui.ts";
import type { Todo } from "./types.ts";
import { fakeTheme as theme } from "../../test/helpers/fakes.ts";

const todos: Todo[] = [
	{ content: "Write schema", status: "completed" },
	{ content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
	{ content: "Ship it", status: "pending" },
];

describe("TodoResult", () => {
	test("renders the indented glyph rail at the render width", () => {
		expect(new TodoResult({ all: todos, rows: todos }, theme).render(60)).toEqual([
			"  ✓ Write schema",
			"  ◐ Writing tests",
			"  ○ Ship it",
			"    1/3 completed",
		]);
	});
});

describe("TodoWidget", () => {
	test("shows progress and the current item on one line", () => {
		const lines = new TodoWidget(todos, theme).render(60);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toBe("Todos · 1/3 · Writing tests");
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
		const lines = new TodoListComponent(
			() => [],
			theme,
			() => {},
			() => {},
		).render(60);
		expect(lines.join("\n")).toContain("No todos yet");
	});

	test("closes on Escape", () => {
		let closed = 0;
		const component = new TodoListComponent(
			() => todos,
			theme,
			() => closed++,
			() => {},
		);
		component.handleInput("\u001b");
		expect(closed).toBe(1);
		component.handleInput("x");
		expect(closed).toBe(1);
	});

	test("keeps the close hint on a narrow screen", () => {
		const lines = new TodoListComponent(
			() => todos,
			theme,
			() => {},
			() => {},
			40,
		)
			.render(60)
			.join("\n");
		expect(lines).toContain("Esc close");
		expect(lines).not.toContain("Home/End");
	});

	test("keeps the header border within the width", () => {
		const lines = new TodoListComponent(
			() => todos,
			theme,
			() => {},
			() => {},
		).render(40);
		expect(visibleWidth(lines[0])).toBe(40);
	});

	test("sizes the window to the terminal height", () => {
		const many: Todo[] = Array.from({ length: 30 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));

		const short = new TodoListComponent(
			() => many,
			theme,
			() => {},
			() => {},
			15,
		)
			.render(60)
			.join("\n");
		expect(short).toContain("showing 1–8 of 30");
		expect(short).not.toContain("item 8");

		const tall = new TodoListComponent(
			() => many,
			theme,
			() => {},
			() => {},
			60,
		)
			.render(60)
			.join("\n");
		expect(tall).toContain("item 29");
		expect(tall).not.toContain("showing");
	});

	test("resolves a live rows getter so a resize re-windows", () => {
		const many: Todo[] = Array.from({ length: 30 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
		let rows = 60;
		const component = new TodoListComponent(
			() => many,
			theme,
			() => {},
			() => {},
			() => rows,
		);
		expect(component.render(60).join("\n")).toContain("item 29");
		rows = 15;
		expect(component.render(60).join("\n")).toContain("showing 1–8 of 30");
	});

	test("the wheel scrolls the list", () => {
		const many: Todo[] = Array.from({ length: 30 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
		let renders = 0;
		const component = new TodoListComponent(
			() => many,
			theme,
			() => {},
			() => renders++,
		);
		component.render(60);
		expect(component.handleMouse({ type: "wheel", wheelDelta: 2 } as any)).toEqual({ handled: true });
		expect(renders).toBe(1);
		expect(component.render(60).join("\n")).toContain("item 2");
		expect(component.handleMouse({ type: "click", button: "left" } as any)).toBeUndefined();
	});

	test("drops the title instead of ellipsizing the border when very narrow", () => {
		const lines = new TodoListComponent(
			() => todos,
			theme,
			() => {},
			() => {},
		).render(6);
		expect(visibleWidth(lines[0])).toBe(6);
		expect(lines[0]).not.toContain("...");
	});

	test("windows long lists and scrolls on demand", () => {
		const many: Todo[] = Array.from({ length: 30 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
		let renders = 0;
		const component = new TodoListComponent(
			() => many,
			theme,
			() => {},
			() => renders++,
		);

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

	test("clips a long row with a single-character ellipsis", () => {
		const long: Todo[] = [{ content: "x".repeat(80), status: "pending" }];
		const line = new TodoListComponent(
			() => long,
			theme,
			() => {},
			() => {},
		)
			.render(20)
			.map(stripTerminalSequences)
			.find((row) => row.includes("x"));
		expect(line?.endsWith("…")).toBe(true);
		expect(line).not.toContain("...");
	});

	test("g/G jump to the ends of the list", () => {
		const many: Todo[] = Array.from({ length: 30 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
		const component = new TodoListComponent(
			() => many,
			theme,
			() => {},
			() => {},
		);
		component.render(60);
		component.handleInput("G");
		expect(component.render(60).join("\n")).toContain("item 29");
		component.handleInput("g");
		expect(component.render(60).join("\n")).toContain("item 0");
	});

	test("re-reads the list through the getter on each render", () => {
		let current: Todo[] = [{ content: "first", status: "pending" }];
		const component = new TodoListComponent(
			() => current,
			theme,
			() => {},
			() => {},
		);
		expect(component.render(60).join("\n")).toContain("first");
		current = [{ content: "second", status: "pending" }];
		expect(component.render(60).join("\n")).toContain("second");
		expect(component.render(60).join("\n")).not.toContain("first");
	});
});

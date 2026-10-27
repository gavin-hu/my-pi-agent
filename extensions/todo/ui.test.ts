import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme as theme } from "../../test/helpers/fakes.ts";
import { formatCallText, formatTodoList, formatTodoText, progressSummary, todoRailLines } from "./format.ts";
import { TodoListComponent, TodoResult, TodoWidget } from "./tui.ts";
import type { Todo } from "./types.ts";

const todos: Todo[] = [
	{ content: "Write schema", status: "completed" },
	{ content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
	{ content: "Ship it", status: "pending" },
];

const many: Todo[] = Array.from({ length: 30 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));

describe("todo formatting", () => {
	test("formatTodoList marks each status", () => {
		expect(formatTodoList(todos)).toBe(["1. ✓ Write schema", "2. ◒ Write tests", "3. ◌ Ship it"].join("\n"));
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

	test("formatCallText shows only progress, never the item text", () => {
		expect(formatCallText([])).toBe("→ clear list");
		expect(formatCallText(undefined)).toBe("→ clear list");
		expect(formatCallText([{ content: "Only", status: "pending" }])).toBe("→ 0/1");
		const line = formatCallText([
			{ content: "Done", status: "completed" },
			{ content: "Work", status: "in_progress", activeForm: "Working" },
			{ content: "Next", status: "pending" },
		]);
		expect(line).toBe("→ 1/3");
		expect(line).not.toContain("Working");
	});

	test("formatCallText distinguishes a streaming call from a clear", () => {
		expect(formatCallText(undefined, false)).toBe("→ …");
		expect(formatCallText([], false)).toBe("→ clear list");
	});
});

describe("todoRailLines", () => {
	test("draws each row at its own left edge, led by the status glyph", () => {
		expect(todoRailLines({ rows: todos }, theme, 60)).toEqual(["✓ Write schema", "◒ Writing tests", "◌ Ship it"]);
	});

	test("wraps a long label with continuation rows under the text column", () => {
		const long: Todo[] = [{ content: "x".repeat(40), status: "pending" }];
		const lines = todoRailLines({ rows: long }, theme, 20);
		expect(lines[0]).toBe(`◌ ${"x".repeat(18)}`);
		expect(lines[1]?.startsWith("  ")).toBe(true);
		expect(lines[1]?.trimStart()).not.toContain("◌");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
	});

	test("reports capped rows with an expand hint and no progress footer", () => {
		const rows: Todo[] = Array.from({ length: 6 }, (_, i) => ({ content: `item ${i}`, status: "pending" as const }));
		const lines = todoRailLines({ rows, more: 2 }, theme, 60);
		expect(lines.at(-1)).toMatch(/^ {2}… 2 more/);
		expect(lines.at(-1)).toContain("to expand");
		expect(lines.some((line) => line.includes("completed"))).toBe(false);
	});
});

describe("TodoResult", () => {
	test("blank line then the glyph rail at the render width", () => {
		expect(new TodoResult({ rows: todos }, theme).render(60)).toEqual([
			"",
			"✓ Write schema",
			"◒ Writing tests",
			"◌ Ship it",
		]);
	});
});

describe("TodoResult memo", () => {
	test("serves a repeat frame, and rebuilds when the list or the theme moves", () => {
		const view = new TodoResult({ rows: todos }, theme);
		const first = view.render(60);
		// A frame re-renders every block: the rail is derived once and compared once.
		expect(view.render(60)).toBe(first);
		view.setInput({ rows: todos.slice(0, 1) }, theme);
		expect(view.render(60)).toEqual(["", "✓ Write schema"]);
		view.invalidate();
		expect(view.render(60)).toEqual(["", "✓ Write schema"]);
		expect(view.render(40)).not.toBe(view.render(60));
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

	test("the wheel scrolls the list", () => {
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

		component.handleInput("\u001b[B");
		expect(renders).toBe(1);
		expect(component.render(60).join("\n")).toContain("showing 2–13 of 30");

		component.handleInput("\u001b[6~");
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

import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { GoalResult, GoalWidget, goalRailLines, goalWidgetLines, WIDGET_KEY } from "./tui.ts";
import type { Goal } from "./types.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";

const theme = fakeTheme;

const active: Goal = { objective: "Ship the parser", status: "active" };
const achieved: Goal = { objective: "Ship the parser", status: "achieved" };
const longGoal: Goal = { objective: "rework ".repeat(80).trim(), status: "active" };

describe("goalWidgetLines", () => {
	test("renders a single label-first rail line while active", () => {
		expect(goalWidgetLines(active, theme, 40)).toEqual(["Goal · active · Ship the parser"]);
	});

	test("renders a single line once achieved", () => {
		expect(goalWidgetLines(achieved, theme, 40)).toEqual(["Goal · achieved · Ship the parser"]);
	});

	test("renders one line when the achieved goal is shown", () => {
		expect(goalWidgetLines(achieved, theme, 40, { achieved: "show" })).toEqual(["Goal · achieved · Ship the parser"]);
	});

	test("hides an achieved goal when asked", () => {
		expect(goalWidgetLines(achieved, theme, 40, { achieved: "hide" })).toEqual([]);
	});

	test("clips a long objective to one line", () => {
		const lines = goalWidgetLines(longGoal, theme, 24);
		expect(lines).toHaveLength(1);
		expect(visibleWidth(lines[0])).toBeLessThanOrEqual(24);
		expect(stripTerminalSequences(lines[0])).toEndWith("…");
	});

	test("keeps every line within the requested width", () => {
		for (const width of [1, 2, 3, 5, 12, 40, 120]) {
			for (const goal of [active, achieved, longGoal]) {
				for (const line of goalWidgetLines(goal, theme, width)) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				}
			}
		}
	});

	test("an ultra-narrow width never overflows", () => {
		expect(visibleWidth(goalWidgetLines(active, theme, 1)[0])).toBeLessThanOrEqual(1);
	});
});

describe("goalRailLines", () => {
	test("aligns wrapped continuation rows under the text", () => {
		const lines = goalRailLines(active, "one two three four five six", theme, 20);
		expect(lines[0]).toBe("Goal · active");
		expect(lines[1]).toBe("  ◎ one two three");
		expect(lines[2].startsWith("    ")).toBe(true);
		expect(lines[2]).not.toContain("◎");
	});
});

describe("GoalWidget", () => {
	test("uses the shared widget key", () => {
		expect(WIDGET_KEY).toBe("goal-widget");
	});

	test("render clamps a non-positive width", () => {
		const widget = new GoalWidget(active, theme);
		expect(widget.render(0)).toEqual(goalWidgetLines(active, theme, 1));
	});

	test("passes the achieved style through", () => {
		expect(new GoalWidget(achieved, theme, { achieved: "hide" }).render(40)).toEqual([]);
		expect(new GoalWidget(achieved, theme, { achieved: "show" }).render(40)[0]).toContain("Goal · achieved");
	});
});

describe("GoalResult", () => {
	test("blank line then the rail uncapped with the themed body", () => {
		const body = theme.fg("text", "line one ".repeat(20).trim());
		const lines = new GoalResult(active, body, theme).render(40);
		expect(lines[0]).toBe("");
		expect(lines[1]).toBe("Goal · active");
		expect(lines[2].startsWith("  ◎ ")).toBe(true);
		expect(lines.length).toBeGreaterThan(4);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	test("updates in place for reuse", () => {
		const view = new GoalResult(active, theme.fg("text", "one"), theme);
		view.update(achieved, theme.fg("text", "two"), theme);
		const lines = view.render(40);
		expect(lines[1]).toBe("Goal · achieved");
		expect(lines.join("\n")).toContain("two");
	});
});

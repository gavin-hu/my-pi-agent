import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { goalWidgetLines, GoalWidget, WIDGET_KEY } from "../../extensions/goal/tui.ts";
import type { Goal } from "../../extensions/goal/types.ts";

/** Identity theme so rendered text stays assertable. */
const theme: any = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

const active: Goal = { objective: "Ship the parser", status: "active" };
const achieved: Goal = { objective: "Ship the parser", status: "achieved" };
const longGoal: Goal = { objective: "rework ".repeat(80).trim(), status: "active" };

describe("goalWidgetLines", () => {
	test("renders a prefixed active header and the objective", () => {
		const lines = goalWidgetLines(active, theme, 40);
		expect(lines[0]).toBe("| ◎ Goal");
		expect(lines[1]).toBe("| Ship the parser");
		expect(lines).toHaveLength(2);
	});

	test("renders an achieved header", () => {
		expect(goalWidgetLines(achieved, theme, 40)[0]).toBe("| ✓ Goal achieved");
	});

	test("caps a long objective and marks the truncation", () => {
		const lines = goalWidgetLines(longGoal, theme, 24);
		expect(lines.length).toBeLessThanOrEqual(3);
		expect(lines[0]).toBe("| ◎ Goal");
		expect(lines.at(-1)).toEndWith("…");
	});

	test("keeps every row within the requested width", () => {
		for (const width of [1, 2, 3, 5, 12, 40, 120]) {
			for (const goal of [active, achieved, longGoal]) {
				for (const line of goalWidgetLines(goal, theme, width)) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				}
			}
		}
	});

	test("truncates the header rather than overflowing an ultra-narrow width", () => {
		const lines = goalWidgetLines(active, theme, 1);
		expect(visibleWidth(lines[0])).toBeLessThanOrEqual(1);
	});
});

describe("GoalWidget", () => {
	test("uses the shared widget key", () => {
		expect(WIDGET_KEY).toBe("goal-widget");
	});

	test("render delegates to goalWidgetLines", () => {
		const widget = new GoalWidget(active, theme);
		expect(widget.render(40)).toEqual(goalWidgetLines(active, theme, 40));
	});

	test("render clamps a non-positive width", () => {
		const widget = new GoalWidget(active, theme);
		expect(widget.render(0)).toEqual(goalWidgetLines(active, theme, 1));
	});
});

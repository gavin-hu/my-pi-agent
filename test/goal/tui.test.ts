import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { GoalResult, GoalWidget, goalRailLines, goalWidgetLines, WIDGET_KEY } from "../../extensions/goal/tui.ts";
import type { Goal } from "../../extensions/goal/types.ts";

/** Identity theme so rendered text stays assertable. */
const theme: any = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

const active: Goal = { objective: "Ship the parser", status: "active" };
const achieved: Goal = { objective: "Ship the parser", status: "achieved" };
const longGoal: Goal = { objective: "rework ".repeat(80).trim(), status: "active" };

describe("goalWidgetLines", () => {
	test("renders a header and a glyph-led objective row", () => {
		const lines = goalWidgetLines(active, theme, 40);
		expect(lines[0]).toBe("Goal · active");
		expect(lines[1]).toBe("  ◎ Ship the parser");
		expect(lines).toHaveLength(2);
	});

	test("collapses an achieved goal to a single line by default", () => {
		const lines = goalWidgetLines(achieved, theme, 40);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toBe("✓ Goal achieved · Ship the parser");
	});

	test("renders an achieved block when asked", () => {
		const lines = goalWidgetLines(achieved, theme, 40, { achieved: "block" });
		expect(lines[0]).toBe("Goal · achieved");
		expect(lines[1]).toBe("  ✓ Ship the parser");
	});

	test("hides an achieved goal when asked", () => {
		expect(goalWidgetLines(achieved, theme, 40, { achieved: "hide" })).toEqual([]);
	});

	test("caps a long objective and marks the truncation", () => {
		const lines = goalWidgetLines(longGoal, theme, 24);
		expect(lines.length).toBeLessThanOrEqual(3);
		expect(lines[0]).toBe("Goal · active");
		expect(stripTerminalSequences(lines.at(-1) ?? "")).toEndWith("…");
	});

	test("honors a custom row budget", () => {
		expect(goalWidgetLines(longGoal, theme, 24, { maxRows: 2 })).toHaveLength(2);
		expect(goalWidgetLines(longGoal, theme, 24, { maxRows: 4 })).toHaveLength(4);
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

	test("render delegates to goalWidgetLines", () => {
		const widget = new GoalWidget(active, theme);
		expect(widget.render(40)).toEqual(goalWidgetLines(active, theme, 40));
	});

	test("render clamps a non-positive width", () => {
		const widget = new GoalWidget(active, theme);
		expect(widget.render(0)).toEqual(goalWidgetLines(active, theme, 1));
	});

	test("passes options through to the layout", () => {
		const widget = new GoalWidget(achieved, theme, { achieved: "block", maxRows: 2 });
		expect(widget.render(40)[0]).toBe("Goal · achieved");
	});
});

describe("GoalResult", () => {
	test("renders the rail uncapped with the themed body", () => {
		const body = theme.fg("text", "line one ".repeat(20).trim());
		const lines = new GoalResult(active, body, theme).render(40);
		expect(lines[0]).toBe("Goal · active");
		expect(lines[1].startsWith("  ◎ ")).toBe(true);
		expect(lines.length).toBeGreaterThan(3);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});
});

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	ACTIVE_SYMBOL,
	ACHIEVED_SYMBOL,
	formatCallText,
	formatGoalNotice,
	formatGoalText,
	goalHeader,
	goalLine,
	goalObjective,
	goalStatusLabel,
	previewObjective,
} from "../../extensions/goal/format.ts";
import type { Goal } from "../../extensions/goal/types.ts";

const theme: any = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

const active: Goal = { objective: "Ship the parser", status: "active" };
const achieved: Goal = { objective: "Ship the parser", status: "achieved" };

describe("headers", () => {
	test("active header names the goal and its status", () => {
		const header = goalHeader(active, theme);
		expect(header).toBe("Goal · active");
		expect(header).not.toContain(ACTIVE_SYMBOL);
	});

	test("achieved header reads as done", () => {
		const header = goalHeader(achieved, theme);
		expect(header).toBe("Goal · achieved");
		expect(header).not.toContain(ACHIEVED_SYMBOL);
	});

	test("status labels are human words", () => {
		expect(goalStatusLabel("active")).toBe("active");
		expect(goalStatusLabel("achieved")).toBe("achieved");
	});

	test("the one-line rail is label-first and names the status", () => {
		expect(goalLine(active, theme)).toBe("Goal · active · Ship the parser");
		expect(goalLine(achieved, theme)).toBe("Goal · achieved · Ship the parser");
	});

	test("objective is dimmed once achieved", () => {
		const tagged: any = { fg: (color: string, text: string) => `[${color}]${text}` };
		expect(goalObjective(active, tagged)).toBe("[text]Ship the parser");
		expect(goalObjective(achieved, tagged)).toBe("[dim]Ship the parser");
	});
});

describe("model-facing text", () => {
	test("active text restates the objective", () => {
		const text = formatGoalText(active);
		expect(text).toContain("Ship the parser");
		expect(text).toContain("mark it achieved");
	});

	test("achieved text confirms completion", () => {
		expect(formatGoalText(achieved)).toBe("Goal achieved: Ship the parser");
	});

	test("a cleared goal says so", () => {
		expect(formatGoalText(null)).toBe("Goal cleared.");
	});

	test("notices describe both states", () => {
		expect(formatGoalNotice(active)).toBe("Goal (active): Ship the parser");
		expect(formatGoalNotice(achieved)).toBe("Goal achieved: Ship the parser");
	});
});

describe("transcript call text", () => {
	test("streaming shows a pending label", () => {
		expect(formatCallText(undefined, false)).toBe("goal → …");
	});

	test("a complete empty objective is a clear", () => {
		expect(formatCallText(undefined, true)).toBe("goal → clear");
		expect(formatCallText("   ", true)).toBe("goal → clear");
	});

	test("a set objective is previewed", () => {
		expect(formatCallText("Ship the parser", true)).toBe("goal → set: Ship the parser");
	});

	test("an achieved call reads as achieve", () => {
		expect(formatCallText("Ship the parser", true, "achieved")).toBe("goal → achieve: Ship the parser");
	});

	test("a long objective is truncated", () => {
		const text = formatCallText("x".repeat(200), true);
		expect(text).toEndWith("…");
	});
});

describe("previewObjective", () => {
	test("keeps short text intact and truncates long text", () => {
		expect(previewObjective("short", 20)).toBe("short");
		expect(previewObjective("x".repeat(30), 10)).toHaveLength(10);
		expect(previewObjective("x".repeat(30), 10)).toEndWith("…");
	});

	test("counts wide characters when truncating", () => {
		const text = previewObjective("a".repeat(8) + "重".repeat(5), 10);
		expect(visibleWidth(text)).toBeLessThanOrEqual(10);
		expect(text).toEndWith("…");
	});
});

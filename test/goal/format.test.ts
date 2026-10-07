import { describe, expect, test } from "bun:test";
import {
	ACTIVE_SYMBOL,
	ACHIEVED_SYMBOL,
	formatCallText,
	formatGoalNotice,
	formatGoalText,
	goalChip,
	goalHeader,
	goalObjective,
	previewObjective,
	ROW_PREFIX,
} from "../../extensions/goal/format.ts";
import type { Goal } from "../../extensions/goal/types.ts";

const theme: any = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

const active: Goal = { objective: "Ship the parser", status: "active" };
const achieved: Goal = { objective: "Ship the parser", status: "achieved" };

describe("headers and chips", () => {
	test("active header carries the bar, the glyph, and the label", () => {
		const header = goalHeader(active, theme);
		expect(header).toStartWith(ROW_PREFIX);
		expect(header).toContain(ACTIVE_SYMBOL);
		expect(header).toContain("Goal");
		expect(header).not.toContain("achieved");
	});

	test("active header includes a status suffix only when asked", () => {
		expect(goalHeader(active, theme)).not.toContain("active");
		expect(goalHeader(active, theme, true)).toContain("active");
	});

	test("achieved header reads as done", () => {
		const header = goalHeader(achieved, theme);
		expect(header).toContain(ACHIEVED_SYMBOL);
		expect(header).toContain("Goal achieved");
	});

	test("objective is dimmed once achieved", () => {
		const tagged: any = { fg: (color: string, text: string) => `[${color}]${text}` };
		expect(goalObjective(active, tagged)).toBe("[text]Ship the parser");
		expect(goalObjective(achieved, tagged)).toBe("[dim]Ship the parser");
	});

	test("status chip names the goal for both states", () => {
		expect(goalChip(active, theme)).toBe("| ◎ goal");
		expect(goalChip(achieved, theme)).toBe("| ✓ goal");
	});

	test("status chip falls back to plain text without a theme", () => {
		expect(goalChip(active)).toBe("| ◎ goal");
		expect(goalChip(achieved)).toBe("| ✓ goal");
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
});

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	formatCallText,
	formatGoalNotice,
	formatGoalText,
	GOAL_HELP,
	goalHeader,
	goalLine,
	goalObjective,
	goalStatusLabel,
	previewObjective,
} from "./format.ts";
import type { Goal } from "./types.ts";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";

const theme = fakeTheme;

const active: Goal = { objective: "Ship the parser", status: "active" };
const achieved: Goal = { objective: "Ship the parser", status: "achieved" };

describe("headers", () => {
	test("active header names the goal and its status", () => {
		expect(goalHeader(active, theme)).toBe("Goal · active");
	});

	test("achieved header reads as done", () => {
		expect(goalHeader(achieved, theme)).toBe("Goal · achieved");
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
		expect(goalObjective(active, coloringTheme)).toBe("[text]Ship the parser");
		expect(goalObjective(achieved, coloringTheme)).toBe("[dim]Ship the parser");
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

	test("help names the set form and the verbs", () => {
		expect(GOAL_HELP).toContain("/goal <what you want to accomplish>");
		expect(GOAL_HELP).toContain("/goal raw <prompt>");
		expect(GOAL_HELP).toContain("/goal edit");
		expect(GOAL_HELP).toContain("/goal done");
		expect(GOAL_HELP).toContain("/goal clear");
		expect(GOAL_HELP).toContain("/goal help");
		// No control characters or ANSI; it goes straight to `notify`.
		expect(GOAL_HELP).not.toContain("\u001b");
	});
});

describe("transcript call text", () => {
	test("streaming shows a pending label", () => {
		expect(formatCallText(undefined, false)).toBe("→ …");
	});

	test("a complete empty objective is a clear", () => {
		expect(formatCallText(undefined, true)).toBe("→ clear");
		expect(formatCallText("   ", true)).toBe("→ clear");
	});

	test("a set objective is previewed", () => {
		expect(formatCallText("Ship the parser", true)).toBe("→ set: Ship the parser");
	});

	test("an achieved call reads as achieve", () => {
		expect(formatCallText("Ship the parser", true, "achieved")).toBe("→ achieve: Ship the parser");
	});

	test("an empty achieved objective reads as achieve, not clear", () => {
		expect(formatCallText("", true, "achieved")).toBe("→ achieve");
		expect(formatCallText("   ", true, "achieved")).toBe("→ achieve");
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

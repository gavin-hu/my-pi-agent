import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeTheme as theme } from "../../test/helpers/fakes.ts";
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
import { MAX_OBJECTIVE, normalizeGoal } from "./schema.ts";
import { GoalHeader, GoalWidget, goalWidgetLines } from "./tui.ts";
import type { Goal } from "./types.ts";

const active: Goal = { objective: "Ship the parser", status: "active" };
const planning: Goal = { objective: "Ship the parser", status: "planning" };
const achieved: Goal = { objective: "Ship the parser", status: "achieved" };
const longGoal: Goal = { objective: "rework ".repeat(80).trim(), status: "active" };
const GOAL_STATUS_LABELS: Goal["status"][] = ["planning", "active", "achieved"];

describe("goal schema", () => {
	test("treats a missing or blank objective as a clear", () => {
		expect(normalizeGoal(undefined)).toBeNull();
		expect(normalizeGoal(null)).toBeNull();
		expect(normalizeGoal({})).toBeNull();
		expect(normalizeGoal({ objective: "" })).toBeNull();
		expect(normalizeGoal({ objective: "   \n\t " })).toBeNull();
	});

	test("treats a non-string objective as a clear", () => {
		expect(normalizeGoal({ objective: 42 })).toBeNull();
		expect(normalizeGoal({ objective: ["nope"] })).toBeNull();
	});

	test("rejects a blank objective that tries to mark the goal achieved", () => {
		expect(() => normalizeGoal({ objective: "", status: "achieved" })).toThrow("resend the full objective");
		expect(() => normalizeGoal({ objective: "   \n", status: "achieved" })).toThrow("resend the full objective");
		expect(() => normalizeGoal({ status: "achieved" })).toThrow("resend the full objective");
	});

	test("still clears a blank objective for an active or default goal", () => {
		expect(normalizeGoal({ objective: "", status: "active" })).toBeNull();
		expect(normalizeGoal({ objective: "" })).toBeNull();
	});

	test("defaults the status to active", () => {
		expect(normalizeGoal({ objective: "Ship the parser" })).toEqual({
			objective: "Ship the parser",
			status: "active",
		});
	});

	test("accepts and normalizes an explicit status", () => {
		expect(normalizeGoal({ objective: "Ship it", status: "achieved" })).toEqual({
			objective: "Ship it",
			status: "achieved",
		});
		expect(normalizeGoal({ objective: "Ship it", status: "ACHIEVED" })?.status).toBe("achieved");
		expect(normalizeGoal({ objective: "Ship it", status: "  Active " })?.status).toBe("active");
	});

	test("trims and collapses whitespace so the objective stays on one line", () => {
		expect(normalizeGoal({ objective: "  first\nsecond\tthird   fourth  " })).toEqual({
			objective: "first second third fourth",
			status: "active",
		});
	});

	test("strips control characters that could corrupt the terminal", () => {
		expect(normalizeGoal({ objective: "safe\u001b[31mRED\u0007" })?.objective).toBe("safe [31mRED");
	});

	test("rejects an unknown status, even when the objective is empty", () => {
		expect(() => normalizeGoal({ objective: "Ship it", status: "blocked" })).toThrow("status must be one of");
		expect(() => normalizeGoal({ objective: "Ship it", status: 42 })).toThrow("status must be one of");
		expect(() => normalizeGoal({ objective: "", status: "blocked" })).toThrow("status must be one of");
		expect(() => normalizeGoal({ status: "blocked" })).toThrow("status must be one of");
	});

	test("accepts an objective at the length limit and rejects one past it", () => {
		expect(normalizeGoal({ objective: "x".repeat(MAX_OBJECTIVE) })?.objective).toHaveLength(MAX_OBJECTIVE);
		expect(() => normalizeGoal({ objective: "x".repeat(MAX_OBJECTIVE + 1) })).toThrow(`longer than ${MAX_OBJECTIVE}`);
	});
});

describe("goal headers and labels", () => {
	test("the status header names the goal and its phase", () => {
		expect(goalHeader(active, theme)).toBe("Goal · active");
		expect(goalHeader(planning, theme)).toBe("Goal · planning");
		expect(goalHeader(achieved, theme)).toBe("Goal · achieved");
	});

	test("status labels are the words the surfaces show", () => {
		expect(GOAL_STATUS_LABELS.map(goalStatusLabel)).toEqual(["planning", "active", "achieved"]);
	});

	test("the one-line rail is label-first and names the status", () => {
		expect(goalLine(active, theme)).toBe("Goal · active · Ship the parser");
		expect(goalLine(planning, theme)).toBe("Goal · planning · Ship the parser");
		expect(goalLine(achieved, theme)).toBe("Goal · achieved · Ship the parser");
	});

	test("the objective is dimmed once achieved", () => {
		expect(goalObjective(active, coloringTheme)).toBe("[text]Ship the parser");
		expect(goalObjective(planning, coloringTheme)).toBe("[text]Ship the parser");
		expect(goalObjective(achieved, coloringTheme)).toBe("[dim]Ship the parser");
	});
});

describe("model-facing text", () => {
	test("an active goal restates the objective and how to complete it", () => {
		const text = formatGoalText(active);
		expect(text).toContain("Ship the parser");
		expect(text).toContain("mark it achieved");
	});

	test("a draft says the plan finalizes it", () => {
		expect(formatGoalText(planning)).toContain("Goal (planning): Ship the parser");
		expect(formatGoalText(planning)).toContain("set from the plan when it is approved");
	});

	test("an achieved goal confirms completion", () => {
		expect(formatGoalText(achieved)).toBe("Goal achieved: Ship the parser");
	});

	test("an achieved goal names the todo items still open", () => {
		expect(formatGoalText(achieved, 1)).toBe(
			"Goal achieved: Ship the parser\n1 todo item is still open; close or clear the list if that work is done.",
		);
		expect(formatGoalText(achieved, 3)).toContain("3 todo items are still open");
		expect(formatGoalText(achieved, 0)).toBe("Goal achieved: Ship the parser");
		expect(formatGoalText(null, 3)).toBe("Goal cleared.");
		expect(formatGoalText(active, 3)).not.toContain("todo");
	});

	test("a cleared goal says so", () => {
		expect(formatGoalText(null)).toBe("Goal cleared.");
	});

	test("notices describe every state and the planning exits", () => {
		expect(formatGoalNotice(planning)).toBe(
			"Goal (planning): Ship the parser\nApprove the plan to set the final goal; leaving plan mode keeps this wording.",
		);
		expect(formatGoalNotice(active)).toBe("Goal (active): Ship the parser");
		expect(formatGoalNotice(achieved)).toBe("Goal achieved: Ship the parser");
	});

	test("help names the set form and the verbs, without terminal escapes", () => {
		expect(GOAL_HELP).toContain("/goal <what you want to accomplish>");
		expect(GOAL_HELP).toContain("/goal raw <prompt>");
		expect(GOAL_HELP).toContain("/goal edit");
		expect(GOAL_HELP).toContain("/goal done");
		expect(GOAL_HELP).toContain("/goal clear");
		expect(GOAL_HELP).toContain("/goal help");
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

	test("an achieved call reads as achieve, even with an empty objective", () => {
		expect(formatCallText("Ship the parser", true, "achieved")).toBe("→ achieve: Ship the parser");
		expect(formatCallText("", true, "achieved")).toBe("→ achieve");
		expect(formatCallText("   ", true, "achieved")).toBe("→ achieve");
	});

	test("a long objective is truncated", () => {
		expect(formatCallText("x".repeat(200), true)).toEndWith("…");
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

describe("goal widget lines", () => {
	test("renders one label-first rail line in each phase", () => {
		expect(goalWidgetLines(active, theme, 40)).toEqual(["Goal · active · Ship the parser"]);
		expect(goalWidgetLines(planning, theme, 40)).toEqual(["Goal · planning · Ship the parser"]);
		expect(goalWidgetLines(achieved, theme, 40)).toEqual(["Goal · achieved · Ship the parser"]);
	});

	test("a draft is visible even when achieved goals are hidden", () => {
		expect(goalWidgetLines(planning, theme, 40, { achieved: "hide" })).toEqual(["Goal · planning · Ship the parser"]);
	});

	test("shows or hides an achieved goal as configured", () => {
		expect(goalWidgetLines(achieved, theme, 40, { achieved: "show" })).toEqual(["Goal · achieved · Ship the parser"]);
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
});

describe("GoalWidget", () => {
	test("render clamps a non-positive width", () => {
		const widget = new GoalWidget(active, theme);
		expect(widget.render(0)).toEqual(goalWidgetLines(active, theme, 1));
	});

	test("passes the achieved style through", () => {
		expect(new GoalWidget(achieved, theme, { achieved: "hide" }).render(40)).toEqual([]);
		expect(new GoalWidget(achieved, theme, { achieved: "show" }).render(40)[0]).toContain("Goal · achieved");
	});
});

describe("GoalHeader", () => {
	test("the status header sits under a blank separator without repeating the objective", () => {
		const lines = new GoalHeader(active, theme).render(40);
		expect(lines).toEqual(["", "Goal · active"]);
	});

	test("clips the header to the width", () => {
		for (const width of [1, 3, 8, 40]) {
			for (const line of new GoalHeader(active, theme).render(width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("updates in place for reuse", () => {
		const view = new GoalHeader(active, theme);
		view.update(achieved, theme);
		expect(view.render(40)).toEqual(["", "Goal · achieved"]);
	});
});

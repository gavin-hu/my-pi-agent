import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	formatPlanAge,
	formatPlanRow,
	PlanListComponent,
	type PlanListAction,
} from "../../extensions/plan/list-tui.ts";
import type { PlanSummary } from "../../extensions/plan/plans.ts";
import { fakeTheme } from "../helpers/fakes.ts";

const DOWN = "\x1b[B";
const UP = "\x1b[A";
const PAGE_DOWN = "\x1b[6~";
const END = "\x1b[F";
const ESCAPE = "\x1b";
const ENTER = "\r";

function summary(title: string, steps = 3): PlanSummary {
	const relativePath = `.pi/plans/2026-10-08-1530-${title}.md`;
	return { path: `/repo/${relativePath}`, relativePath, title, bytes: 10, modified: 0, steps };
}

function setup(plans: PlanSummary[], rows?: number, activePlanPath?: string) {
	const actions: Array<PlanListAction | undefined> = [];
	let renders = 0;
	const component = new PlanListComponent({
		plans,
		theme: fakeTheme,
		activePlanPath,
		onClose: (action) => actions.push(action),
		requestRender: () => {
			renders += 1;
		},
		viewportRows: rows,
	});
	return { component, actions, renders: () => renders };
}

const NOW = new Date(2026, 9, 8, 15, 30).getTime();

describe("formatPlanAge", () => {
	test("formats recent times relative to now", () => {
		expect(formatPlanAge(NOW - 30_000, NOW)).toBe("just now");
		expect(formatPlanAge(NOW - 5 * 60_000, NOW)).toBe("5m ago");
		expect(formatPlanAge(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
		expect(formatPlanAge(NOW - 2 * 86_400_000, NOW)).toBe("2d ago");
	});

	test("falls back to a local date after a week", () => {
		expect(formatPlanAge(new Date(2026, 2, 4, 12, 0).getTime(), NOW)).toBe("2026-03-04");
	});
});

describe("formatPlanRow", () => {
	test("renders the title, step count, age, and path, clipped to width", () => {
		const plan = { ...summary("demo", 1), modified: NOW - 2 * 3_600_000 };
		const row = formatPlanRow(plan, 80, { now: NOW });
		expect(row).toContain("◦ demo · 1 step · 2h ago · .pi/plans/2026-10-08-1530-demo.md");
		expect(visibleWidth(formatPlanRow(plan, 12, { now: NOW }))).toBeLessThanOrEqual(12);
	});

	test("marks the active plan with a filled bullet", () => {
		const plan = { ...summary("demo"), modified: NOW };
		expect(formatPlanRow(plan, 80, { now: NOW, active: true })).toContain("● demo");
		expect(formatPlanRow(plan, 80, { now: NOW, active: false })).toContain("◦ demo");
	});
});

describe("PlanListComponent — render", () => {
	test("stays within the terminal width", () => {
		const { component } = setup([summary("a"), summary("b")]);
		for (const width of [20, 40, 80, 1]) {
			for (const line of component.render(width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("shows the header, count, and row data", () => {
		const { component } = setup([summary("first"), summary("second", 1)]);
		const text = component.render(80).join("\n");
		expect(text).toContain("Plans");
		expect(text).toContain("2 plans · newest first");
		expect(text).toContain("◦ first · 3 steps ·");
		expect(text).toContain("◦ second · 1 step ·");
		expect(text).toContain("Enter view · d delete · u use · Esc close");
	});

	test("puts the count directly under the rule, then a blank, then rows", () => {
		const { component } = setup([summary("alpha"), summary("beta")]);
		const lines = component.render(80);
		expect(lines[0]).toContain("Plans");
		expect(lines[1]).toBe("  2 plans · newest first");
		expect(lines[2]).toBe("");
		expect(lines[3]).toContain("alpha");
	});

	test("marks the active plan with a filled bullet", () => {
		const active = summary("alpha");
		const { component } = setup([active, summary("beta")], undefined, active.path);
		const text = component.render(80).join("\n");
		expect(text).toContain("● alpha");
		expect(text).toContain("◦ beta");
	});

	test("renders a clear empty state with only Esc", () => {
		const { component } = setup([]);
		const text = component.render(80).join("\n");
		expect(text).toContain("No plans yet");
		expect(text).toContain("Esc close");
		expect(text).not.toContain("Enter view");
	});
});

describe("PlanListComponent — input", () => {
	test("moves the cursor and clamps at both ends", () => {
		const { component, actions, renders } = setup([summary("a"), summary("b"), summary("c")]);
		component.handleInput(UP); // already at the top
		component.handleInput(DOWN);
		component.handleInput(DOWN);
		component.handleInput(DOWN); // past the bottom
		component.handleInput(END);
		expect(component.render(80).join("\n")).toContain("❯ ◦ c");
		expect(renders()).toBeGreaterThan(0);
		void actions;
	});

	test("Enter views the focused plan", () => {
		const { component, actions } = setup([summary("a"), summary("b")]);
		component.handleInput(DOWN);
		component.handleInput(ENTER);
		expect(actions).toHaveLength(1);
		expect(actions[0]?.action).toBe("view");
		expect((actions[0] as { plan: PlanSummary }).plan.title).toBe("b");
	});

	test("d and u emit delete and use for the focused plan", () => {
		const deleteTest = setup([summary("a")]);
		deleteTest.component.handleInput("d");
		expect(deleteTest.actions[0]?.action).toBe("delete");

		const useTest = setup([summary("a")]);
		useTest.component.handleInput("u");
		expect(useTest.actions[0]?.action).toBe("use");
	});

	test("Esc closes with no action and PgDn pages", () => {
		const { component, actions } = setup([summary("a"), summary("b"), summary("c")], 2);
		component.handleInput(PAGE_DOWN);
		component.handleInput(ESCAPE);
		expect(actions).toEqual([undefined]);
	});

	test("ignores Enter, d, and u on an empty list", () => {
		const { component, actions } = setup([]);
		component.handleInput(ENTER);
		component.handleInput("d");
		component.handleInput("u");
		expect(actions).toEqual([]);
	});

	test("still handles input after the TUI marks it focusable", () => {
		// pi-tui treats any component with a `focused` member as Focusable and
		// assigns `focused = true/false`. Regression: a `focused()` method used to
		// be shadowed by that boolean, so this threw "this.focused is not a function".
		const { component, actions } = setup([summary("a")]);
		(component as unknown as { focused: boolean }).focused = true;
		component.handleInput(ENTER);
		expect(actions).toHaveLength(1);
		expect(actions[0]?.action).toBe("view");
	});
});

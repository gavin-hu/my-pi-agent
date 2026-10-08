import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatPlanRow, PlanListComponent, type PlanListAction } from "../../extensions/plan-mode/list-tui.ts";
import type { PlanSummary } from "../../extensions/plan-mode/plans.ts";
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

function setup(plans: PlanSummary[], rows?: number) {
	const actions: Array<PlanListAction | undefined> = [];
	let renders = 0;
	const component = new PlanListComponent({
		plans,
		theme: fakeTheme,
		onClose: (action) => actions.push(action),
		requestRender: () => {
			renders += 1;
		},
		viewportRows: rows,
	});
	return { component, actions, renders: () => renders };
}

describe("formatPlanRow", () => {
	test("renders the title, step count, and path, clipped to width", () => {
		const row = formatPlanRow(summary("demo", 1), 80);
		expect(row).toContain("◦ demo · 1 step · .pi/plans/2026-10-08-1530-demo.md");
		expect(visibleWidth(formatPlanRow(summary("demo"), 12))).toBeLessThanOrEqual(12);
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

	test("renders a clear empty state with only Esc", () => {
		const { component } = setup([]);
		const text = component.render(80).join("\n");
		expect(text).toContain("(no plans yet");
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
});

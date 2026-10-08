import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PlanViewComponent, type PlanViewAction } from "../../extensions/plan/tui.ts";
import type { StoredPlan } from "../../extensions/plan/plans.ts";
import { fakeTheme } from "../helpers/fakes.ts";

const tui = { requestRender: () => {}, terminal: { rows: 24, columns: 80 } } as any;

const DOWN = "\x1b[B";
const HOME = "\x1b[H";
const END = "\x1b[F";
const PAGE_DOWN = "\x1b[6~";
const ESCAPE = "\x1b";

function plan(content: string, path = "/repo/.pi/plans/2026-10-08-1530-demo.md"): StoredPlan {
	return { path, relativePath: ".pi/plans/2026-10-08-1530-demo.md", content, bytes: content.length };
}

describe("PlanViewComponent — browse mode", () => {
	test("drops approve and refine from the header and footer", () => {
		const { component } = setup(undefined, { mode: "browse" });
		const text = render(component, 80).join("\n");
		expect(text).toContain("Plan · demo");
		expect(text).not.toContain("Plan Review");
		expect(text).toContain("Esc close");
		expect(text).not.toContain("a approve");
		expect(text).not.toContain("r refine");
	});

	test("a and r are inert; Esc still closes with keep", () => {
		const { component, actions } = setup(undefined, { mode: "browse" });
		component.handleInput("a");
		component.handleInput("r");
		expect(actions).toEqual([]);
		component.handleInput("\u001b");
		expect(actions).toEqual(["keep"]);
	});

	test("review mode still offers approve and refine", () => {
		const { component, actions } = setup();
		component.handleInput("a");
		expect(actions).toEqual(["approve"]);
	});
});

function render(component: PlanViewComponent, width: number): string[] {
	return component.render(width);
}

function setup(
	content = "# Plan\n1. Read the parser\n2. Add a tokenizer",
	options: { rows?: number; mode?: "review" | "browse"; tui?: unknown } = {},
) {
	const actions: PlanViewAction[] = [];
	const refinements: Array<string | undefined> = [];
	let renders = 0;
	const component = new PlanViewComponent({
		plan: plan(content),
		theme: fakeTheme,
		onClose: (action, refinement) => {
			actions.push(action);
			refinements.push(refinement);
		},
		requestRender: () => {
			renders += 1;
		},
		viewportRows: options.rows,
		mode: options.mode,
		tui: options.tui as any,
	});
	return { component, actions, refinements, renders: () => renders };
}

describe("PlanViewComponent — render", () => {
	test("stays within the terminal width", () => {
		const { component } = setup();
		for (const width of [20, 40, 80, 1]) {
			for (const line of render(component, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("shows the title but no subtitle row", () => {
		const { component } = setup();
		const lines = render(component, 80);
		const text = lines.join("\n");
		expect(text).toContain("Plan Review");
		expect(text).toContain("demo");
		expect(text).not.toContain(".pi/plans/2026-10-08-1530-demo.md");
		expect(text).not.toContain("2 steps");
		expect(lines[1]).toBe("");
		expect(lines[2]).toContain("Plan");
	});

	test("renders the plan body and the key hints", () => {
		const { component } = setup();
		const text = render(component, 80).join("\n");
		expect(text).toContain("Read the parser");
		expect(text).toContain("a approve");
		expect(text).toContain("Esc keep planning");
	});

	test("strips terminal control characters", () => {
		const { component } = setup("hello\u001b[31mred\u001b[0m world\u0007");
		const text = render(component, 80).join("\n");
		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("\u0007");
	});

	test("handles an empty plan", () => {
		const { component } = setup("");
		const text = render(component, 80).join("\n");
		expect(text).toContain("This plan is empty.");
	});

	test("expands tabs and strips line-breaking control characters", () => {
		const { component } = setup("a\tb\rcd\u009b");
		const lines = render(component, 20);
		for (const line of lines) {
			expect(line).not.toContain("\t");
			expect(line).not.toContain("\r");
			expect(line).not.toContain("\u009b");
			expect(visibleWidth(line)).toBeLessThanOrEqual(20);
		}
		expect(lines.join("\n")).toContain("a    b cd");
	});

	test("shortens the header title and keeps it on narrow terminals", () => {
		const { component } = setup();
		const full = render(component, 80)[0];
		expect(full).toContain("Plan Review");
		expect(full).toContain("demo");
		expect(full).not.toContain("2026-10-08-1530");
		expect(render(component, 20)[0]).toContain("Plan Review");
	});
});

describe("PlanViewComponent — scrolling", () => {
	const manyLines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join("\n");

	test("clamps scrolling to the body and repaints", () => {
		const { component, renders } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput(DOWN);
		component.handleInput(DOWN);
		expect(renders()).toBe(2);
		const scrolled = render(component, 80);
		expect(scrolled.some((line) => line.includes("Line 3"))).toBe(true);
	});

	test("End jumps to the tail and Home returns to the top", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput(END);
		const tail = render(component, 80).join("\n");
		expect(tail).toContain("Line 60");
		component.handleInput(HOME);
		const top = render(component, 80).join("\n");
		expect(top).toContain("Line 1");
	});

	test("page down keeps one line of overlap", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput(PAGE_DOWN);
		const text = render(component, 80).join("\n");
		// viewport is 15 rows, so a page advances 14 lines.
		expect(text).toContain("Line 15");
	});

	test("d and u move by half a page", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput("d");
		expect(render(component, 80).join("\n")).toContain("Line 8");
		component.handleInput("u");
		expect(render(component, 80).join("\n")).toContain("Line 1");
	});

	test("g and G jump to the ends", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput("G");
		expect(render(component, 80).join("\n")).toContain("Line 60");
		component.handleInput("g");
		expect(render(component, 80).join("\n")).toContain("Line 1");
	});

	test("the wheel scrolls the body", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		expect(component.handleMouse({ type: "wheel", wheelDelta: 3 } as any)).toEqual({ handled: true });
		expect(render(component, 80).join("\n")).toContain("Line 4");
		expect(component.handleMouse({ type: "click", button: "left" } as any)).toBeUndefined();
	});

	test("shows a scroll position only when the plan overflows", () => {
		const scrolled = setup(manyLines, { rows: 20 });
		render(scrolled.component, 80);
		expect(render(scrolled.component, 80).join("\n")).toContain("(0%)");
		scrolled.component.handleInput(END);
		expect(render(scrolled.component, 80).join("\n")).toContain("(100%)");

		const fits = setup();
		const text = render(fits.component, 80).join("\n");
		expect(text).not.toContain("of");
		expect(text).not.toContain("↑↓");
	});

	test("shows only the footer hints that fit", () => {
		const narrow = setup(manyLines, { rows: 20 });
		const short = render(narrow.component, 40).at(-2) ?? "";
		expect(short).toContain("a approve");
		expect(short).toContain("r refine");
		expect(short).toContain("Esc keep");
		expect(short).not.toContain("space");
		expect(short).not.toContain("…");

		const wide = setup(manyLines, { rows: 24 });
		const full = render(wide.component, 120).at(-2) ?? "";
		expect(full).toContain("space/b page");
		expect(full).toContain("g/G ends");
	});

	test("rebuilds wrapped lines after invalidate", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.invalidate();
		expect(render(component, 80).join("\n")).toContain("Line 1");
	});

	test("a width change keeps the same source line on top", () => {
		const content = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} ${"x".repeat(40)}`).join("\n");
		const { component } = setup(content, { rows: 12 });
		render(component, 40);
		for (let i = 0; i < 7; i++) component.handleInput(DOWN);
		// Walk to the next source-line boundary so the check does not depend on wrap counts.
		let guard = 0;
		while (guard++ < 20 && !/^\s*Line \d+ /i.test(render(component, 40)[2] ?? "")) component.handleInput(DOWN);
		const before = /\d+/.exec(render(component, 40)[2] ?? "")?.[0];
		expect(before).toBeDefined();
		expect(before).not.toBe("1");
		expect(render(component, 120)[2] ?? "").toContain(`Line ${before} `);
	});
});

describe("PlanViewComponent — actions", () => {
	test("a approves, r refines, Esc keeps planning", () => {
		const approve = setup();
		approve.component.handleInput("a");
		expect(approve.actions).toEqual(["approve"]);

		const refine = setup();
		refine.component.handleInput("r");
		expect(refine.actions).toEqual(["refine"]);

		const keep = setup();
		keep.component.handleInput(ESCAPE);
		expect(keep.actions).toEqual(["keep"]);
	});

	test("j and k scroll instead of acting", () => {
		const { component, actions } = setup("Line 1\nLine 2");
		component.handleInput("j");
		component.handleInput("k");
		expect(actions).toEqual([]);
	});
});

describe("PlanViewComponent — inline refine", () => {
	test("r opens the inline editor and keeps the review open", () => {
		const { component, actions } = setup(undefined, { tui });
		render(component, 80);
		component.handleInput("r");
		expect(actions).toEqual([]);
		const text = render(component, 80).join("\n");
		expect(text).toContain("Refine the plan:");
		expect(text).toContain("Enter submit");
		expect(text).toContain("Esc back to plan");
	});

	test("typing and Enter submits the refinement text", () => {
		const { component, actions, refinements } = setup(undefined, { tui });
		render(component, 80);
		component.handleInput("r");
		component.handleInput("use a hand-written lexer");
		component.handleInput("\r");
		expect(actions).toEqual(["refine"]);
		expect(refinements).toEqual(["use a hand-written lexer"]);
	});

	test("an empty submission stays in the editor", () => {
		const { component, actions } = setup(undefined, { tui });
		render(component, 80);
		component.handleInput("r");
		component.handleInput("\r");
		expect(actions).toEqual([]);
		expect(render(component, 80).join("\n")).toContain("Refine the plan:");
	});

	test("Esc leaves the editor and returns to the review", () => {
		const { component, actions } = setup(undefined, { tui });
		render(component, 80);
		component.handleInput("r");
		component.handleInput("\x1b");
		expect(actions).toEqual([]);
		component.handleInput("a");
		expect(actions).toEqual(["approve"]);
	});

	test("without a TUI, r still closes with refine", () => {
		const { component, actions } = setup();
		component.handleInput("r");
		expect(actions).toEqual(["refine"]);
	});
});

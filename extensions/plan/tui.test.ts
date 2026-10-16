import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { coloringTheme, fakeMarkdownTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import type { StoredPlan } from "./plans.ts";
import { PlanViewComponent, type PlanViewAction } from "./tui.ts";

const tui = { requestRender: () => {}, terminal: { rows: 24, columns: 80 } } as any;

const DOWN = "\x1b[B";
const HOME = "\x1b[H";
const END = "\x1b[F";
const PAGE_DOWN = "\x1b[6~";
const ESCAPE = "\x1b";

function plan(content: string, path = "/repo/.pi/plans/2026-10-08-1530-demo.md"): StoredPlan {
	return { path, relativePath: ".pi/plans/2026-10-08-1530-demo.md", content, bytes: content.length };
}

function render(component: PlanViewComponent, width: number): string[] {
	return component.render(width);
}

interface SetupOptions {
	rows?: number;
	tui?: unknown;
	theme?: any;
	markdownTheme?: any;
	path?: string;
}

function setup(content = "# Plan\n1. Read the parser\n2. Add a tokenizer", options: SetupOptions = {}) {
	const actions: PlanViewAction[] = [];
	const refinements: Array<string | undefined> = [];
	let renders = 0;
	const theme = options.theme ?? fakeTheme;
	const component = new PlanViewComponent({
		plan: plan(content, options.path),
		theme,
		markdownTheme: options.markdownTheme ?? fakeMarkdownTheme(theme),
		onClose: (action, refinement) => {
			actions.push(action);
			refinements.push(refinement);
		},
		requestRender: () => {
			renders += 1;
		},
		viewportRows: options.rows,
		tui: options.tui as any,
	});
	return { component, actions, refinements, renders: () => renders };
}

/** Percent shown in the scroll row, or -1 when there is none. */
function percent(lines: string[]): number {
	const match = /(\d+)%/.exec(lines.join("\n"));
	return match ? Number(match[1]) : -1;
}

describe("PlanViewComponent — render", () => {
	test("stays within the terminal width", () => {
		const { component } = setup();
		for (const width of [80, 40, 20, 7, 6, 5, 4, 3, 2, 1]) {
			for (const line of render(component, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("shows the title and body without the file path", () => {
		const { component } = setup();
		const lines = render(component, 80);
		const text = lines.join("\n");
		expect(text).toContain("Plan Review");
		expect(text).toContain("demo");
		expect(text).not.toContain(".pi/plans/2026-10-08-1530-demo.md");
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
		expect(lines.join("\n").replace(/\s+/g, " ")).toContain("a b cd");
	});

	test("shortens the header title and keeps it on narrow terminals", () => {
		const { component } = setup();
		const full = render(component, 80)[0];
		expect(full).toContain("Plan Review");
		expect(full).toContain("demo");
		expect(full).not.toContain("2026-10-08-1530");
		expect(render(component, 20)[0]).toContain("Plan Review");
	});

	test("colors task checkboxes by state", () => {
		const theme = coloringTheme;
		const { component } = setup("- [x] Done task\n- [ ] Pending task", {
			theme,
			markdownTheme: fakeMarkdownTheme(theme),
		});
		const text = render(component, 80).join("\n");
		expect(text).toContain("[success][✓]");
		expect(text).toContain("[dim][ ]");
	});

	test("renders headings through the injected Markdown theme", () => {
		const theme = coloringTheme;
		const { component } = setup("# Title\n\n1. Step", { theme, markdownTheme: fakeMarkdownTheme(theme) });
		expect(render(component, 80).join("\n")).toContain("[mdHeading]");
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

	test("End jumps to the tail", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput(END);
		expect(render(component, 80).join("\n")).toContain("Line 60");
	});

	test("Home returns to the top", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput(END);
		component.handleInput(HOME);
		expect(render(component, 80).join("\n")).toContain("Line 1");
	});

	test("page down keeps one line of overlap", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput(PAGE_DOWN);
		const text = render(component, 80).join("\n");
		// viewport is 15 rows, so a page advances 14 lines.
		expect(text).toContain("Line 15");
	});

	test("d moves down half a page", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput("d");
		expect(render(component, 80).join("\n")).toContain("Line 8");
	});

	test("u moves back up half a page", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput("d");
		component.handleInput("u");
		expect(render(component, 80).join("\n")).toContain("Line 1");
	});

	test("G jumps to the end", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput("G");
		expect(render(component, 80).join("\n")).toContain("Line 60");
	});

	test("g jumps to the start", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput("G");
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

	test("shows a scroll gauge only when the plan overflows", () => {
		const scrolled = setup(manyLines, { rows: 20 });
		render(scrolled.component, 80);
		let text = render(scrolled.component, 80).join("\n");
		expect(text).toContain("lines 1–15 of 60");
		expect(text).toContain("0%");
		scrolled.component.handleInput(END);
		text = render(scrolled.component, 80).join("\n");
		expect(text).toContain("100%");
		expect(text).toContain("lines 46–60 of 60");

		const fits = setup();
		expect(render(fits.component, 80).join("\n")).not.toContain("lines ");
	});

	test("drops the scroll range before the gauge on a narrow terminal", () => {
		const { component } = setup(manyLines, { rows: 24 });
		const row = render(component, 20).at(-3) ?? "";
		expect(row).toContain("0%");
		expect(row).toContain(GLYPHS.gaugeEmpty);
		expect(row).not.toContain("lines");
	});

	test("shows only the footer hints that fit", () => {
		const narrow = setup(manyLines, { rows: 20 });
		const short = render(narrow.component, 60).at(-2) ?? "";
		expect(short).toContain("a approve");
		expect(short).toContain("r refine");
		expect(short).toContain("Esc keep planning");
		expect(short).not.toContain("space");
		expect(short).not.toContain("…");

		const wide = setup(manyLines, { rows: 24 });
		const full = render(wide.component, 120).at(-2) ?? "";
		expect(full).toContain("space/b page");
		expect(full).toContain("g/G ends");
	});

	test("leads with the safe exit when only one hint fits", () => {
		const narrow = setup(manyLines, { rows: 20 });
		const hint = render(narrow.component, 20).at(-2) ?? "";
		expect(hint).toContain("Esc keep planning");
		expect(hint).not.toContain("a approve");
	});

	test("colors the approve, refine, and browser hints", () => {
		const theme = coloringTheme;
		const { component } = setup(undefined, { theme, markdownTheme: fakeMarkdownTheme(theme) });
		const hint = render(component, 200).at(-2) ?? "";
		expect(hint).toContain("[success]a approve");
		expect(hint).toContain("[accent]r refine");
		expect(hint).toContain("[accent]w browser");
	});

	test("rebuilds wrapped lines after invalidate", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.invalidate();
		expect(render(component, 80).join("\n")).toContain("Line 1");
	});

	test("a resize keeps the reading position", () => {
		const content = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} ${"x".repeat(40)}`).join("\n");
		const { component } = setup(content, { rows: 16 });
		render(component, 40);
		component.handleInput("d");
		const before = percent(render(component, 40));
		expect(before).toBeGreaterThan(0);
		const after = percent(render(component, 120));
		expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
	});
});

describe("PlanViewComponent — sections", () => {
	const sectioned = Array.from({ length: 132 }, (_, i) => (i % 12 === 0 ? `## Section ${i / 12}` : `line ${i}`)).join(
		"\n",
	);

	/** The scroll row, one above the hint row and the trailing blank. */
	const scrollLine = (component: PlanViewComponent): string => render(component, 80).at(-3) ?? "";

	test("shows the current section and jumps to the next and previous", () => {
		const { component } = setup(sectioned, { rows: 20 });
		expect(scrollLine(component)).toContain(`${GLYPHS.plan} Section 0`);

		component.handleInput("n");
		expect(scrollLine(component)).toContain(`${GLYPHS.plan} Section 1`);

		component.handleInput("n");
		expect(scrollLine(component)).toContain(`${GLYPHS.plan} Section 2`);

		component.handleInput("p");
		expect(scrollLine(component)).toContain(`${GLYPHS.plan} Section 1`);
	});

	test("p at the first section stays at the top", () => {
		const { component } = setup(sectioned, { rows: 20 });
		component.handleInput("p");
		expect(scrollLine(component)).toContain(`${GLYPHS.plan} Section 0`);
	});

	test("offers the section-jump hint only when the plan has sections", () => {
		const withSections = setup(sectioned, { rows: 20 });
		expect(render(withSections.component, 120).join("\n")).toContain("n/p section");

		const plain = setup(Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join("\n"), { rows: 20 });
		expect(render(plain.component, 120).join("\n")).not.toContain("n/p section");
		expect(scrollLine(plain.component)).not.toContain(GLYPHS.plan);
	});

	test("ignores section jumps when the plan fits", () => {
		const { component } = setup("## Only\n\nshort", { rows: 40 });
		component.handleInput("n");
		expect(render(component, 80).join("\n")).toContain("Only");
	});
});

describe("PlanViewComponent — actions", () => {
	test("a approves, r refines, w opens the browser, Esc keeps planning", () => {
		const approve = setup();
		approve.component.handleInput("a");
		expect(approve.actions).toEqual(["approve"]);

		const refine = setup();
		refine.component.handleInput("r");
		expect(refine.actions).toEqual(["refine"]);

		const browser = setup();
		browser.component.handleInput("w");
		expect(browser.actions).toEqual(["browser"]);

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

	test("keeps the scroll gauge visible while editing", () => {
		const manyLines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join("\n");
		const { component } = setup(manyLines, { rows: 20, tui });
		render(component, 80);
		component.handleInput("r");
		const text = render(component, 80).join("\n");
		expect(text).toContain("Refine the plan:");
		expect(text).toMatch(/lines \d+–\d+ of \d+/);
	});

	test("leads the refine footer with the safe exit on a narrow screen", () => {
		const { component } = setup(undefined, { tui });
		render(component, 80);
		component.handleInput("r");
		const text = render(component, 20).join("\n");
		expect(text).toContain("Esc back to plan");
		expect(text).not.toContain("Enter submit");
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

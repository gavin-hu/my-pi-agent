/**
 * The plan review screen: its width-safe Markdown body, scroll and section
 * navigation, overflow gauge, footer hints, actions, inline refine editor, and
 * changed-section markers.
 *
 * The component is driven directly at fixed widths and row counts, so no test
 * needs a terminal. Assertions are about fields, bounds, ordering, and glyphs,
 * never literal column padding.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth, type MarkdownTheme, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { coloringTheme, fakeMarkdownTheme, fakeTheme, roleSgrTheme } from "../../test/helpers/fakes.ts";
import { sectionDigests } from "./plan-text.ts";
import type { StoredPlan } from "./plans.ts";
import { PlanViewComponent, type PlanViewAction, type PlanViewOptions } from "./tui.ts";

type TuiHandle = NonNullable<PlanViewOptions["tui"]>;
type Theme = PlanViewOptions["theme"];

const tui = { requestRender: () => {}, terminal: { rows: 24, columns: 80 } } as unknown as TuiHandle;

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
	theme?: Theme;
	markdownTheme?: MarkdownTheme;
	path?: string;
	/** Content the previous review showed, for the changed markers. */
	baseline?: string;
}

function setup(content = "# Plan\n1. Read the parser\n2. Add a tokenizer", options: SetupOptions = {}) {
	const actions: PlanViewAction[] = [];
	const refinements: Array<string | undefined> = [];
	let renders = 0;
	const theme = options.theme ?? fakeTheme;
	const component = new PlanViewComponent({
		plan: plan(content, options.path),
		baseline: options.baseline === undefined ? undefined : sectionDigests(options.baseline),
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
		tui: options.tui as TuiHandle | undefined,
	});
	return { component, actions, refinements, renders: () => renders };
}

/** Percent shown in the scroll row, or -1 when there is none. */
function percent(lines: string[]): number {
	const match = /(\d+)%/.exec(lines.join("\n"));
	return match ? Number(match[1]) : -1;
}

/** A line's leading-space count, so an indent assertion names no padding width. */
function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}

describe("plan review render", () => {
	test("stays within the terminal width", () => {
		const { component } = setup();
		for (const width of [80, 40, 20, 7, 6, 5, 4, 3, 2, 1]) {
			for (const line of render(component, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("keeps a wrapped task item under its own indent", () => {
		// The themed marker is narrower than the `- [ ] ` it replaces, and pi-tui
		// derives a continuation line's indent from the original marker. Without
		// padding, the overflow lands at the body indent as a stray fragment instead
		// of staying under the item.
		const step = "Record every resolved step with its owner, the file it touched, and the reason it was accepted";
		const { component } = setup(`# Plan\n\n## Steps\n- [ ] ${step}`, {
			theme: roleSgrTheme,
			markdownTheme: fakeMarkdownTheme(roleSgrTheme),
		});
		const strip = (line: string): string => line.replace(/\u001b\[[0-9;]*m/g, "");
		const lines = render(component, 40).map(strip);
		const start = lines.findIndex((line) => line.includes("◻"));
		const end = lines.findIndex((line) => line.includes("Esc keep planning"));
		const body = lines.slice(start, end).filter((line) => line !== "");
		const [first, ...rest] = body;

		expect(first).toContain("Record");
		expect(rest.length).toBeGreaterThan(1);
		const indents = rest.map(indentOf);
		expect(indents.every((indent) => indent === indents[0])).toBe(true);
		expect(indents[0]).toBeGreaterThan(0);
		// The padding must not eat text either.
		expect(body.join(" ").replace(/\s+/g, " ")).toContain(step);
	});

	test("shows the plan title and body without the file path", () => {
		const text = render(setup().component, 80).join("\n");
		expect(text).toContain("Plan Review");
		expect(text).toContain("demo");
		expect(text).toContain("Plan");
		expect(text).not.toContain(".pi/plans/2026-10-08-1530-demo.md");
	});

	test("renders the key hints", () => {
		const text = render(setup().component, 80).join("\n");
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
		expect(render(setup("").component, 80).join("\n")).toContain("This plan is empty.");
	});

	test("expands tabs and strips line-breaking control characters", () => {
		const lines = render(setup("a\tb\rcd\u009b").component, 20);
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
		const full = render(component, 80)[0] ?? "";
		expect(full).toContain("Plan Review");
		expect(full).toContain("demo");
		expect(full).not.toContain("2026-10-08-1530");
		expect(render(component, 20)[0]).toContain("Plan Review");
	});

	test("colors task checkboxes by state", () => {
		const { component } = setup("- [x] Done task\n- [ ] Pending task", {
			theme: coloringTheme,
			markdownTheme: fakeMarkdownTheme(coloringTheme),
		});
		const text = render(component, 80).join("\n");
		expect(text).toContain(`[success]${GLYPHS.boxOn}`);
		expect(text).toContain(`[dim]${GLYPHS.boxOff}`);
	});

	test("renders headings through the injected Markdown theme", () => {
		const { component } = setup("# Title\n\n1. Step", {
			theme: coloringTheme,
			markdownTheme: fakeMarkdownTheme(coloringTheme),
		});
		expect(render(component, 80).join("\n")).toContain("[mdHeading]");
	});
});

const manyLines = Array.from({ length: 60 }, (_, index) => `Line ${index + 1}`).join("\n");

describe("plan review scrolling", () => {
	test("clamps scrolling to the body and repaints", () => {
		const { component, renders } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput(DOWN);
		component.handleInput(DOWN);

		expect(renders()).toBe(2);
		expect(render(component, 80).some((line) => line.includes("Line 3"))).toBe(true);
	});

	test("End jumps to the tail and Home returns to the top", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);

		component.handleInput(END);
		expect(render(component, 80).join("\n")).toContain("Line 60");

		component.handleInput(HOME);
		expect(render(component, 80).join("\n")).toContain("Line 1");
	});

	test("a page keeps one line of overlap", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);
		component.handleInput(PAGE_DOWN);
		// The viewport is 15 rows, so a page advances 14 lines.
		expect(render(component, 80).join("\n")).toContain("Line 15");
	});

	test("d and u move half a page", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);

		component.handleInput("d");
		expect(render(component, 80).join("\n")).toContain("Line 8");

		component.handleInput("u");
		expect(render(component, 80).join("\n")).toContain("Line 1");
	});

	test("G and g jump to the ends", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);

		component.handleInput("G");
		expect(render(component, 80).join("\n")).toContain("Line 60");

		component.handleInput("g");
		expect(render(component, 80).join("\n")).toContain("Line 1");
	});

	test("the wheel scrolls the body but a click is left to the terminal", () => {
		const { component } = setup(manyLines, { rows: 20 });
		render(component, 80);

		expect(component.handleMouse({ type: "wheel", wheelDelta: 3 } as unknown as TuiMouseEvent)).toEqual({
			handled: true,
		});
		expect(render(component, 80).join("\n")).toContain("Line 4");
		expect(component.handleMouse({ type: "click", button: "left" } as unknown as TuiMouseEvent)).toBeUndefined();
	});

	test("shows a scroll gauge only when the plan overflows", () => {
		const scrolled = setup(manyLines, { rows: 20 });
		render(scrolled.component, 80);
		let text = render(scrolled.component, 80).join("\n");
		expect(text).toMatch(/lines 1–\d+ of 60/);
		expect(text).toContain("0%");

		scrolled.component.handleInput(END);
		text = render(scrolled.component, 80).join("\n");
		expect(text).toContain("100%");
		expect(text).toMatch(/lines \d+–60 of 60/);

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
		const { component } = setup(undefined, {
			theme: coloringTheme,
			markdownTheme: fakeMarkdownTheme(coloringTheme),
		});
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
		const content = Array.from({ length: 60 }, (_, index) => `Line ${index + 1} ${"x".repeat(40)}`).join("\n");
		const { component } = setup(content, { rows: 16 });
		render(component, 40);
		component.handleInput("d");
		const before = percent(render(component, 40));
		expect(before).toBeGreaterThan(0);

		const after = percent(render(component, 120));
		expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
	});
});

describe("plan review sections", () => {
	const sectioned = Array.from({ length: 132 }, (_, index) =>
		index % 12 === 0 ? `## Section ${index / 12}` : `line ${index}`,
	).join("\n");

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

		const plain = setup(manyLines, { rows: 20 });
		expect(render(plain.component, 120).join("\n")).not.toContain("n/p section");
		expect(scrollLine(plain.component)).not.toContain(GLYPHS.plan);
	});

	test("ignores section jumps when the plan fits", () => {
		const { component } = setup("## Only\n\nshort", { rows: 40 });
		component.handleInput("n");
		expect(render(component, 80).join("\n")).toContain("Only");
	});
});

describe("plan review actions", () => {
	test("a approves, r refines, w opens the browser, Esc keeps planning", () => {
		for (const [key, action] of [
			["a", "approve"],
			["r", "refine"],
			["w", "browser"],
			[ESCAPE, "keep"],
		] as const) {
			const chosen = setup();
			chosen.component.handleInput(key);
			expect(chosen.actions).toEqual([action]);
		}
	});

	test("j and k scroll instead of acting", () => {
		const { component, actions } = setup("Line 1\nLine 2");
		component.handleInput("j");
		component.handleInput("k");
		expect(actions).toEqual([]);
	});
});

describe("plan review inline refine", () => {
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
		component.handleInput(ESCAPE);

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

describe("plan review changed sections", () => {
	const before = ["# Plan", "## Goal", "Ship it.", "## Steps", "- [ ] One"].join("\n");
	const after = ["# Plan", "## Goal", "Ship it well.", "## Steps", "- [ ] One", "- [ ] Two"].join("\n");

	/** The scroll row, one above the hint row and the trailing blank. */
	const scrollLine = (component: PlanViewComponent): string => render(component, 80).at(-3) ?? "";

	test("summarizes the sections that changed", () => {
		const { component } = setup(after, { baseline: before });
		expect(render(component, 100).join("\n")).toContain("2 sections changed since your last review");
	});

	test("says nothing on a first review or an unchanged plan", () => {
		expect(render(setup(after).component, 100).join("\n")).not.toContain("changed since your last review");
		expect(render(setup(after, { baseline: after }).component, 100).join("\n")).not.toContain(
			"changed since your last review",
		);
	});

	test("marks the current section in the scroll row", () => {
		const long = Array.from({ length: 60 }, (_, index) => `line ${index}`).join("\n");
		const { component } = setup(`# Plan\n${long}\nchanged line`, {
			rows: 20,
			baseline: `# Plan\n${long}`,
		});
		expect(scrollLine(component)).toContain("Plan · changed");
	});

	test("stays within the width with the summary", () => {
		const { component } = setup(after, { baseline: before });
		for (const width of [80, 40, 20, 12, 6]) {
			for (const line of render(component, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("counts one section for a duplicate heading that changed once", () => {
		const previous = ["# Plan", "## Notes", "a", "## Notes", "b"].join("\n");
		const current = ["# Plan", "## Notes", "a", "## Notes", "B"].join("\n");
		const { component } = setup(current, { baseline: previous });
		expect(render(component, 100).join("\n")).toContain("1 section changed since your last review");
	});

	test("a plan with a tab is unchanged after being shown once", () => {
		// The digest is computed over the same normalization the body is rendered
		// with, so a tab the reader saw is not reported as a change.
		const tabbed = ["# Plan", "## Goal", "\tTabbed body", "## Steps", "- [ ] One"].join("\n");
		const { component } = setup(tabbed, { baseline: tabbed });
		expect(render(component, 100).join("\n")).not.toContain("changed since your last review");
	});
});

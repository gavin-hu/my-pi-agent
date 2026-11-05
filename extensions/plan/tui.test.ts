/**
 * The plan review screen: its width-safe Markdown body, scroll and section
 * navigation, overflow gauge, footer hints, the approve question, actions, inline
 * refine editor, and changed-section markers.
 *
 * The component is driven directly at fixed widths and row counts, so no test
 * needs a terminal. Assertions are about fields, bounds, ordering, and glyphs,
 * never literal column padding.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { coloringTheme, fakeMarkdownTheme, roleSgrTheme } from "../../test/helpers/fakes.ts";
import { MANY_LINES, SECTIONED_PLAN } from "../../test/helpers/fixtures/plan-view.ts";
import { planReview, renderReview, REVIEW_TUI } from "../../test/helpers/plan-view.ts";
import { PlanViewComponent } from "./tui.ts";

/** A TUI handle stub, for the inline refine editor. */
const tui = REVIEW_TUI;

const DOWN = "\x1b[B";
const HOME = "\x1b[H";
const END = "\x1b[F";
const PAGE_DOWN = "\x1b[6~";
const ESCAPE = "\x1b";

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
		const { component } = planReview();
		for (const width of [80, 40, 20, 7, 6, 5, 4, 3, 2, 1]) {
			for (const line of renderReview(component, width)) {
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
		const { component } = planReview(`# Plan\n\n## Steps\n- [ ] ${step}`, {
			theme: roleSgrTheme,
			markdownTheme: fakeMarkdownTheme(roleSgrTheme),
		});
		const strip = (line: string): string => line.replace(/\u001b\[[0-9;]*m/g, "");
		const lines = renderReview(component, 40).map(strip);
		const start = lines.findIndex((line) => line.includes("◻"));
		const end = lines.findIndex((line) => line.includes("Esc keep plan"));
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
		const text = renderReview(planReview().component, 80).join("\n");
		expect(text).toContain("Plan Review");
		expect(text).toContain("demo");
		expect(text).toContain("Plan");
		expect(text).not.toContain("~/.pi/agent/plans/a1f9c02/2026-10-08-1530-demo.md");
	});

	test("renders the key hints", () => {
		const text = renderReview(planReview().component, 80).join("\n");
		expect(text).toContain("Read the parser");
		expect(text).toContain("a approve");
		expect(text).toContain("Esc keep plan");
	});

	test("x exits plan mode without approving", () => {
		const { component, actions } = planReview();
		component.handleInput("x");
		expect(actions).toEqual(["cancel"]);
	});

	test("strips terminal control characters", () => {
		const { component } = planReview("hello\u001b[31mred\u001b[0m world\u0007");
		const text = renderReview(component, 80).join("\n");
		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("\u0007");
	});

	test("handles an empty plan", () => {
		expect(renderReview(planReview("").component, 80).join("\n")).toContain("This plan is empty.");
	});

	test("expands tabs and strips line-breaking control characters", () => {
		const lines = renderReview(planReview("a\tb\rcd\u009b").component, 20);
		for (const line of lines) {
			expect(line).not.toContain("\t");
			expect(line).not.toContain("\r");
			expect(line).not.toContain("\u009b");
			expect(visibleWidth(line)).toBeLessThanOrEqual(20);
		}
		expect(lines.join("\n").replace(/\s+/g, " ")).toContain("a b cd");
	});

	test("shortens the header title and keeps it on narrow terminals", () => {
		const { component } = planReview();
		const full = renderReview(component, 80)[0] ?? "";
		expect(full).toContain("Plan Review");
		expect(full).toContain("demo");
		expect(full).not.toContain("2026-10-08-1530");
		expect(renderReview(component, 20)[0]).toContain("Plan Review");
	});

	test("colors task checkboxes by state", () => {
		const { component } = planReview("- [x] Done task\n- [ ] Pending task", {
			theme: coloringTheme,
			markdownTheme: fakeMarkdownTheme(coloringTheme),
		});
		const text = renderReview(component, 80).join("\n");
		expect(text).toContain(`[success]${GLYPHS.boxOn}`);
		expect(text).toContain(`[dim]${GLYPHS.boxOff}`);
	});

	test("renders headings through the injected Markdown theme", () => {
		const { component } = planReview("# Title\n\n1. Step", {
			theme: coloringTheme,
			markdownTheme: fakeMarkdownTheme(coloringTheme),
		});
		expect(renderReview(component, 80).join("\n")).toContain("[mdHeading]");
	});
});

const manyLines = MANY_LINES;

describe("plan review comments", () => {
	const strip = (line: string): string => line.replace(/\u001b\[[0-9;]*m/g, "");

	test("shows a teammate's comment under the block it refers to", () => {
		const { component } = planReview("# Plan\n- [ ] one\n> [!REVIEW] @alice: name the ceiling\n- [ ] two");
		const lines = renderReview(component, 80).map(strip);

		const comment = lines.findIndex((line) => line.includes("@alice"));
		const block = lines.findIndex((line) => line.includes("one"));
		expect(comment).toBeGreaterThan(block);
		expect(lines[comment]).toContain("name the ceiling");
	});

	test("marks the owner's own comment as a review note", () => {
		const { component } = planReview("# Plan\n- [ ] one\n> [!REVIEW] what about bursts");
		const lines = renderReview(component, 80).map(strip);
		expect(lines.some((line) => line.includes("Review: what about bursts"))).toBe(true);
	});

	test("never shows the stored marker itself", () => {
		const { component } = planReview("# Plan\n- [ ] one\n> [!REVIEW] @alice: theirs");
		expect(renderReview(component, 80).map(strip).join("\n")).not.toContain("[!REVIEW]");
	});

	test("keeps a reviewed plan inside the terminal width", () => {
		const { component } = planReview(
			"# Plan\n- [ ] one\n> [!REVIEW] @a-very-long-reviewer-name: a comment long enough to wrap several times over",
		);
		for (const width of [80, 40, 20]) {
			for (const line of renderReview(component, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("plan review scrolling", () => {
	test("clamps scrolling to the body and repaints", () => {
		const { component, renders } = planReview(manyLines, { rows: 20 });
		renderReview(component, 80);
		component.handleInput(DOWN);
		component.handleInput(DOWN);

		expect(renders()).toBe(2);
		expect(renderReview(component, 80).some((line) => line.includes("Line 3"))).toBe(true);
	});

	test("End jumps to the tail and Home returns to the top", () => {
		const { component } = planReview(manyLines, { rows: 20 });
		renderReview(component, 80);

		component.handleInput(END);
		expect(renderReview(component, 80).join("\n")).toContain("Line 60");

		component.handleInput(HOME);
		expect(renderReview(component, 80).join("\n")).toContain("Line 1");
	});

	test("a page keeps one line of overlap", () => {
		const { component } = planReview(manyLines, { rows: 20 });
		renderReview(component, 80);
		component.handleInput(PAGE_DOWN);
		// The viewport is 15 rows, so a page advances 14 lines.
		expect(renderReview(component, 80).join("\n")).toContain("Line 15");
	});

	test("d and u move half a page", () => {
		const { component } = planReview(manyLines, { rows: 20 });
		renderReview(component, 80);

		component.handleInput("d");
		expect(renderReview(component, 80).join("\n")).toContain("Line 8");

		component.handleInput("u");
		expect(renderReview(component, 80).join("\n")).toContain("Line 1");
	});

	test("G and g jump to the ends", () => {
		const { component } = planReview(manyLines, { rows: 20 });
		renderReview(component, 80);

		component.handleInput("G");
		expect(renderReview(component, 80).join("\n")).toContain("Line 60");

		component.handleInput("g");
		expect(renderReview(component, 80).join("\n")).toContain("Line 1");
	});

	test("the wheel scrolls the body but a click is left to the terminal", () => {
		const { component } = planReview(manyLines, { rows: 20 });
		renderReview(component, 80);

		expect(component.handleMouse({ type: "wheel", wheelDelta: 3 } as unknown as TuiMouseEvent)).toEqual({
			handled: true,
		});
		expect(renderReview(component, 80).join("\n")).toContain("Line 4");
		expect(component.handleMouse({ type: "click", button: "left" } as unknown as TuiMouseEvent)).toBeUndefined();
	});

	test("shows a scroll gauge only when the plan overflows", () => {
		const scrolled = planReview(manyLines, { rows: 20 });
		renderReview(scrolled.component, 80);
		let text = renderReview(scrolled.component, 80).join("\n");
		expect(text).toMatch(/lines 1–\d+ of 60/);
		expect(text).toContain("0%");

		scrolled.component.handleInput(END);
		text = renderReview(scrolled.component, 80).join("\n");
		expect(text).toContain("100%");
		expect(text).toMatch(/lines \d+–60 of 60/);

		const fits = planReview();
		expect(renderReview(fits.component, 80).join("\n")).not.toContain("lines ");
	});

	test("drops the scroll range before the gauge on a narrow terminal", () => {
		const { component } = planReview(manyLines, { rows: 24 });
		const row = renderReview(component, 20).at(-3) ?? "";
		expect(row).toContain("0%");
		expect(row).toContain(GLYPHS.gaugeEmpty);
		expect(row).not.toContain("lines");
	});

	test("rebuilds wrapped lines after invalidate", () => {
		const { component } = planReview(manyLines, { rows: 20 });
		renderReview(component, 80);
		component.invalidate();
		expect(renderReview(component, 80).join("\n")).toContain("Line 1");
	});

	test("a resize keeps the reading position", () => {
		const content = Array.from({ length: 60 }, (_, index) => `Line ${index + 1} ${"x".repeat(40)}`).join("\n");
		const { component } = planReview(content, { rows: 16 });
		renderReview(component, 40);
		component.handleInput("d");
		const before = percent(renderReview(component, 40));
		expect(before).toBeGreaterThan(0);

		const after = percent(renderReview(component, 120));
		expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
	});
});

describe("plan review sections", () => {
	const sectioned = SECTIONED_PLAN;

	/** The scroll row, one above the hint row and the closing rule. */
	const scrollLine = (component: PlanViewComponent): string => renderReview(component, 80).at(-3) ?? "";

	test("shows the current section and jumps to the next and previous", () => {
		const { component } = planReview(sectioned, { rows: 20 });
		expect(scrollLine(component)).toContain(`${GLYPHS.plan} Section 0`);

		component.handleInput("n");
		expect(scrollLine(component)).toContain(`${GLYPHS.plan} Section 1`);

		component.handleInput("n");
		expect(scrollLine(component)).toContain(`${GLYPHS.plan} Section 2`);

		component.handleInput("p");
		expect(scrollLine(component)).toContain(`${GLYPHS.plan} Section 1`);
	});

	test("p at the first section stays at the top", () => {
		const { component } = planReview(sectioned, { rows: 20 });
		component.handleInput("p");
		expect(scrollLine(component)).toContain(`${GLYPHS.plan} Section 0`);
	});

	test("offers the section-jump hint only when the plan has sections", () => {
		const withSections = planReview(sectioned, { rows: 20 });
		expect(renderReview(withSections.component, 120).join("\n")).toContain("n/p section");

		const plain = planReview(manyLines, { rows: 20 });
		expect(renderReview(plain.component, 120).join("\n")).not.toContain("n/p section");
		expect(scrollLine(plain.component)).not.toContain(GLYPHS.plan);
	});

	test("ignores section jumps when the plan fits", () => {
		const { component } = planReview("## Only\n\nshort", { rows: 40 });
		component.handleInput("n");
		expect(renderReview(component, 80).join("\n")).toContain("Only");
	});
});

describe("plan review actions", () => {
	test("r refines, w opens the browser, Esc keeps planning", () => {
		for (const [key, action] of [
			["r", "refine"],
			["w", "browser"],
			[ESCAPE, "keep"],
		] as const) {
			const chosen = planReview();
			chosen.component.handleInput(key);
			expect(chosen.actions).toEqual([action]);
		}
	});

	test("a asks y/N before approving", () => {
		const { component, actions } = planReview();

		component.handleInput("a");
		expect(actions).toEqual([]);
		expect(renderReview(component, 80).join("\n")).toContain("Approve & run the plan? y/N");

		component.handleInput("y");
		expect(actions).toEqual(["approve"]);
	});

	test("Enter accepts the approval question too", () => {
		const { component, actions } = planReview();
		component.handleInput("a");
		component.handleInput("\r");

		expect(actions).toEqual(["approve"]);
	});

	test("n, q, and Esc dismiss the question and keep the review", () => {
		for (const key of ["n", "q", ESCAPE]) {
			const { component, actions } = planReview();
			component.handleInput("a");
			component.handleInput(key);

			expect(actions, key).toEqual([]);
			expect(renderReview(component, 80).join("\n"), key).toContain("a approve");

			// The review is still there, so the ordinary exit still works.
			component.handleInput(ESCAPE);
			expect(actions, key).toEqual(["keep"]);
		}
	});

	test("a pending question holds every other key", () => {
		const { component, actions } = planReview();
		component.handleInput("a");
		component.handleInput("x");
		component.handleInput("w");

		expect(actions).toEqual([]);
		expect(renderReview(component, 80).join("\n")).toContain("plan mode off, 2 steps to todo, goal set");
	});

	test("the question stays within the terminal width", () => {
		const { component } = planReview();
		component.handleInput("a");
		for (const width of [120, 80, 40, 20]) {
			for (const line of renderReview(component, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("j and k scroll instead of acting", () => {
		const { component, actions } = planReview("Line 1\nLine 2");
		component.handleInput("j");
		component.handleInput("k");
		expect(actions).toEqual([]);
	});
});

describe("plan review inline refine", () => {
	test("r opens the inline editor and keeps the review open", () => {
		const { component, actions } = planReview(undefined, { tui });
		renderReview(component, 80);
		component.handleInput("r");

		expect(actions).toEqual([]);
		const text = renderReview(component, 80).join("\n");
		expect(text).toContain("Refine the plan:");
		expect(text).toContain("Enter submit");
		expect(text).toContain("Esc back to plan");
	});

	test("keeps the scroll gauge visible while editing", () => {
		const { component } = planReview(manyLines, { rows: 20, tui });
		renderReview(component, 80);
		component.handleInput("r");

		const text = renderReview(component, 80).join("\n");
		expect(text).toContain("Refine the plan:");
		expect(text).toMatch(/lines \d+–\d+ of \d+/);
	});

	test("typing and Enter submits the refinement text", () => {
		const { component, actions, refinements } = planReview(undefined, { tui });
		renderReview(component, 80);
		component.handleInput("r");
		component.handleInput("use a hand-written lexer");
		component.handleInput("\r");

		expect(actions).toEqual(["refine"]);
		expect(refinements).toEqual(["use a hand-written lexer"]);
	});

	test("an empty submission stays in the editor", () => {
		const { component, actions } = planReview(undefined, { tui });
		renderReview(component, 80);
		component.handleInput("r");
		component.handleInput("\r");

		expect(actions).toEqual([]);
		expect(renderReview(component, 80).join("\n")).toContain("Refine the plan:");
	});

	test("Esc leaves the editor and returns to the review", () => {
		const { component, actions } = planReview(undefined, { tui });
		renderReview(component, 80);
		component.handleInput("r");
		component.handleInput(ESCAPE);

		expect(actions).toEqual([]);
		component.handleInput("a");
		component.handleInput("y");
		expect(actions).toEqual(["approve"]);
	});

	test("without a TUI, r still closes with refine", () => {
		const { component, actions } = planReview();
		component.handleInput("r");
		expect(actions).toEqual(["refine"]);
	});
});

describe("plan review changed sections", () => {
	const before = ["# Plan", "## Goal", "Ship it.", "## Steps", "- [ ] One"].join("\n");
	const after = ["# Plan", "## Goal", "Ship it well.", "## Steps", "- [ ] One", "- [ ] Two"].join("\n");

	/** The scroll row, one above the hint row and the closing rule. */
	const scrollLine = (component: PlanViewComponent): string => renderReview(component, 80).at(-3) ?? "";

	test("summarizes the sections that changed", () => {
		const { component } = planReview(after, { baseline: before });
		expect(renderReview(component, 100).join("\n")).toContain("2 sections changed since your last review");
	});

	test("says nothing on a first review or an unchanged plan", () => {
		expect(renderReview(planReview(after).component, 100).join("\n")).not.toContain("changed since your last review");
		expect(renderReview(planReview(after, { baseline: after }).component, 100).join("\n")).not.toContain(
			"changed since your last review",
		);
	});

	test("marks the current section in the scroll row", () => {
		const long = Array.from({ length: 60 }, (_, index) => `line ${index}`).join("\n");
		const { component } = planReview(`# Plan\n${long}\nchanged line`, {
			rows: 20,
			baseline: `# Plan\n${long}`,
		});
		expect(scrollLine(component)).toContain("Plan · changed");
	});

	test("stays within the width with the summary", () => {
		const { component } = planReview(after, { baseline: before });
		for (const width of [80, 40, 20, 12, 6]) {
			for (const line of renderReview(component, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("counts one section for a duplicate heading that changed once", () => {
		const previous = ["# Plan", "## Notes", "a", "## Notes", "b"].join("\n");
		const current = ["# Plan", "## Notes", "a", "## Notes", "B"].join("\n");
		const { component } = planReview(current, { baseline: previous });
		expect(renderReview(component, 100).join("\n")).toContain("1 section changed since your last review");
	});

	test("a plan with a tab is unchanged after being shown once", () => {
		// The digest is computed over the same normalization the body is rendered
		// with, so a tab the reader saw is not reported as a change.
		const tabbed = ["# Plan", "## Goal", "\tTabbed body", "## Steps", "- [ ] One"].join("\n");
		const { component } = planReview(tabbed, { baseline: tabbed });
		expect(renderReview(component, 100).join("\n")).not.toContain("changed since your last review");
	});
});

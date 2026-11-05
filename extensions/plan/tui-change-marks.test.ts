/**
 * The review's changed-section marks — the count row, the body's margin mark, and
 * the scroll row's suffix — plus the task-item split the two surfaces that draw a
 * plan share.
 *
 * Split out of `tui.test.ts`, which is at its height ratchet, over the same
 * `plan-view` harness: a case states its fixture and its assertion, and no case
 * needs a terminal. Assertions name glyphs, columns, and bounds, never padding
 * widths.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { planReview, renderReview, scrollRow } from "../../test/helpers/plan-view.ts";
import { taskMarker } from "./plan-text.ts";
import { textExit } from "./tools/exit.ts";

/** A plan before and after a refinement touched both of its sections. */
const before = ["# Plan", "## Goal", "Ship it.", "## Steps", "- [ ] One"].join("\n");
const after = ["# Plan", "## Goal", "Ship it well.", "## Steps", "- [ ] One", "- [ ] Two"].join("\n");

/** The body line carrying `text`, or "" when the frame shows none. */
function lineWith(lines: string[], text: string): string {
	return lines.find((line) => line.includes(text)) ?? "";
}

describe("plan review changed sections", () => {
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
		expect(scrollRow(component)).toContain("Plan · changed");
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

describe("the changed mark in the body", () => {
	/** One section changed, so a frame with a mark can still show an unmarked one. */
	const current = ["# Plan", "## Goal", "Ship it.", "## Steps", "- [ ] One", "- [ ] Two"].join("\n");
	const baseline = ["# Plan", "## Goal", "Ship it.", "## Steps", "- [ ] One"].join("\n");

	test("sits in the margin of the section that changed", () => {
		const lines = renderReview(planReview(current, { baseline }).component, 80);
		// The mark replaces the body's first padding column, so the heading keeps its
		// own column and an unchanged one reads at the same indent with no mark.
		expect(lineWith(lines, "Steps").startsWith(GLYPHS.changed)).toBe(true);
		expect(lineWith(lines, "Goal").startsWith(GLYPHS.changed)).toBe(false);
		expect(lineWith(lines, "Goal").indexOf("Goal")).toBe(lineWith(lines, "Steps").indexOf("Steps"));
	});

	test("leaves a first review and an unchanged plan unmarked", () => {
		for (const lines of [
			renderReview(planReview(current).component, 80),
			renderReview(planReview(current, { baseline: current }).component, 80),
		]) {
			expect(lines.some((line) => line.startsWith(GLYPHS.changed))).toBe(false);
		}
	});

	test("marks a preamble, which has no heading to mark", () => {
		// Content before the first heading is a section titled "": one rule marks the
		// first line of whatever changed, so it needs no case of its own.
		const { component } = planReview("alpha\nbeta", { baseline: "alpha\nBETA" });
		expect(lineWith(renderReview(component, 40), "alpha").startsWith(GLYPHS.changed)).toBe(true);
	});

	test("keeps the mark visible at every width the body is padded at", () => {
		const { component } = planReview(after, { baseline: before });
		for (const width of [80, 40, 20, 12, 6]) {
			expect(renderReview(component, width).some((line) => line.startsWith(GLYPHS.changed))).toBe(true);
		}
	});

	test("keeps the frame in its columns below the padding floor", () => {
		// Under six columns the body has no padding to give way, so the mark is drawn in
		// front of the line and the line loses its tail instead.
		const { component } = planReview(after, { baseline: before });
		for (const width of [5, 4, 3, 2, 1]) {
			for (const line of renderReview(component, width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("a task item's marker", () => {
	test("keeps the item's text in the column the file put it in", () => {
		// The box is one column where `[ ]` was three: the two freed columns are
		// padding, which is what lets the review screen and the transcript agree.
		const item = "Add a token-bucket limiter";
		for (const line of [`- [ ] ${item}`, `1. [x] ${item}`, `  12. [ ] ${item}`]) {
			const marker = taskMarker(line);
			expect(marker).not.toBeNull();
			if (marker === null) continue;
			const drawn = `${marker.pre}${GLYPHS.boxOff}${marker.post}`;
			expect(drawn.indexOf(item)).toBe(line.indexOf(item));
		}
	});

	test("names a numbered, a ticked, and an empty item", () => {
		expect(taskMarker("1. [x] One")).toMatchObject({ pre: "1. ", checked: true });
		expect(taskMarker("- [ ] Two")).toMatchObject({ pre: "- ", checked: false });
		expect(taskMarker("- [ ]")?.checked).toBe(false);
	});

	test("is nothing for a plain list item or a bracket in prose", () => {
		expect(taskMarker("- One")).toBeNull();
		expect(taskMarker("A [ ] in prose")).toBeNull();
	});

	test("the transcript's preview draws the review screen's box", () => {
		// The two surfaces share the split and nothing else: one draws through a Markdown
		// theme, the other paints plain lines.
		const plan = ["# Plan", "## Steps", "- [ ] One", "- [x] Two"].join("\n");
		const text = textExit({ action: "exit", approved: true, plan, planPath: "/x/p.md" }, true, fakeTheme);
		expect(text).toContain(GLYPHS.boxOff);
		expect(text).toContain(GLYPHS.boxOn);
		expect(text).not.toContain("[ ]");
	});
});

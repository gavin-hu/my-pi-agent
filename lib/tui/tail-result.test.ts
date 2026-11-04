/**
 * The shared tail block: the rows a tool result lists, the headed groups it draws
 * them in, the bounded tail, and the guard an extension reads its own block back
 * through. Split from the tool-transcript kit so neither suite carries the other's
 * cases.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { isTailResult, TailResult } from "./tool.ts";

describe("TailResult", () => {
	const rowLine = (row: string, width: number): string => `${row}:${width}`;

	test("draws a leading blank line, the rows, and the overflow note", () => {
		const view = new TailResult<string>({ kind: "list", rows: ["a", "b"], more: 2, rowLine }, fakeTheme);
		const lines = view.render(40);
		expect(lines[0]).toBe("");
		expect(lines[1]).toBe("a:40");
		expect(lines[2]).toBe("b:40");
		expect(lines[3]).toContain("… 2 more");
	});

	test("draws the earlier note and the themed tail", () => {
		const view = new TailResult<string>(
			{ kind: "lines", lines: ["one", "two"], earlier: 5, earlierLabel: "lines" },
			fakeTheme,
		);
		const lines = view.render(40);
		expect(lines[0]).toBe("");
		expect(lines[1]).toContain("… 5 earlier lines");
		expect(lines[2]).toBe("one");
		expect(lines[3]).toBe("two");
	});

	test("clips every line to the render width", () => {
		const view = new TailResult<string>(
			{ kind: "lines", lines: ["x".repeat(20)], earlier: 0, earlierLabel: "lines" },
			fakeTheme,
		);
		expect(visibleWidth(view.render(10)[1] ?? "")).toBeLessThanOrEqual(10);
	});

	test("draws one group of rows per section, with a faint heading and a per-section overflow note", () => {
		const view = new TailResult<string>(
			{
				kind: "sections",
				sections: [
					{ rows: ["a"], more: 0, rowLine },
					{ label: "Claims", rows: ["b"], more: 2, rowLine },
				],
			},
			fakeTheme,
		);
		const lines = view.render(40);
		expect(lines[0]).toBe("");
		expect(lines[1]).toBe("a:40");
		expect(lines[2]).toBe("");
		expect(lines[3]).toBe("Claims");
		expect(lines[4]).toBe("b:40");
		expect(lines[5]).toContain("… 2 more");
		expect(lines).toHaveLength(6);
	});

	test("draws a row that returns several lines, in a list and under a heading", () => {
		const list = new TailResult<string>(
			{ kind: "list", rows: ["a"], more: 0, rowLine: () => ["head", "body"] },
			fakeTheme,
		);
		expect(list.render(40)).toEqual(["", "head", "body"]);
		const headed = new TailResult<string>(
			{ kind: "sections", sections: [{ label: "Mail", rows: ["a"], more: 0, rowLine: () => ["head", "body"] }] },
			fakeTheme,
		);
		expect(headed.render(40)).toEqual(["", "Mail", "head", "body"]);
	});

	test("opens the first heading with no blank line above it, an empty first group included", () => {
		const view = new TailResult<string>(
			{
				kind: "sections",
				sections: [
					{ label: "Conflicts", rows: [], more: 0, rowLine },
					{ label: "Claimed", rows: ["a"], more: 0, rowLine },
				],
			},
			fakeTheme,
		);
		const lines = view.render(40);
		expect(lines[1]).toBe("Conflicts");
		expect(lines[2]).toBe("");
		expect(lines[3]).toBe("Claimed");
	});

	test("keeps an unlabeled section against the rows above it, where it is more of the same list", () => {
		const view = new TailResult<string>(
			{
				kind: "sections",
				sections: [
					{ rows: ["a"], more: 0, rowLine },
					{ rows: ["b"], more: 0, rowLine },
				],
			},
			fakeTheme,
		);
		expect(view.render(40)).toEqual(["", "a:40", "b:40"]);
	});

	test("clips a section heading to the render width", () => {
		const view = new TailResult<string>(
			{ kind: "sections", sections: [{ label: "C".repeat(20), rows: [], more: 0, rowLine }] },
			fakeTheme,
		);
		expect(visibleWidth(view.render(10)[1] ?? "")).toBeLessThanOrEqual(10);
	});

	test("updates in place for reuse", () => {
		const view = new TailResult<string>(
			{ kind: "lines", lines: ["old"], earlier: 0, earlierLabel: "lines" },
			fakeTheme,
		);
		view.setInput({ kind: "lines", lines: ["new"], earlier: 0, earlierLabel: "lines" }, fakeTheme);
		expect(view.render(40)).toEqual(["", "new"]);
	});

	test("serves a repeat frame from its memo, and rebuilds when the input moves", () => {
		// A frame re-renders every block, so this one is derived once and compared
		// once until its input, theme or width changes.
		let built = 0;
		const counted = (row: string, width: number): string => {
			built += 1;
			return `${row}:${width}`;
		};
		const view = new TailResult<string>({ kind: "list", rows: ["a"], more: 0, rowLine: counted }, fakeTheme);
		const first = view.render(40);
		expect(view.render(40)).toBe(first);
		expect(built).toBe(1);

		// `setInput` is the invalidation: the new rows are built, then held again.
		view.setInput({ kind: "list", rows: ["a", "b"], more: 0, rowLine: counted }, fakeTheme);
		expect(view.render(40)).toEqual(["", "a:40", "b:40"]);
		expect(built).toBe(3);

		// A new width is a new layout; `invalidate` drops it for a theme change.
		view.render(20);
		expect(built).toBe(5);
		view.invalidate();
		view.render(20);
		expect(built).toBe(7);
	});
});

describe("isTailResult", () => {
	test("recognises the kit's block through the erased row type", () => {
		// The extensions reuse their block through `context.lastComponent`, so the guard is
		// where the row type the caller drew is put back on the instance.
		const view = new TailResult<string>({ kind: "lines", lines: ["x"], earlier: 0, earlierLabel: "lines" }, fakeTheme);
		expect(isTailResult<string>(view)).toBe(true);
		expect(isTailResult<string>({ render: () => [] })).toBe(false);
		expect(isTailResult<string>(undefined)).toBe(false);
		expect(isTailResult<string>("TailResult")).toBe(false);
	});
});

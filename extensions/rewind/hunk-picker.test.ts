import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { HunkPickerComponent } from "./hunk-picker.ts";
import type { Hunk } from "./patch.ts";

const HUNKS: Hunk[] = [
	{
		header: "@@ -1,3 +1,3 @@ function one() {",
		lines: [" keep", "-old one", "+new one", " keep"],
		added: 1,
		removed: 1,
	},
	{
		header: "@@ -20,3 +20,4 @@ function two() {",
		lines: [" keep", "-old two", "+new two", "+extra", " tail"],
		added: 2,
		removed: 1,
	},
];

/** Mount the picker and record what `onClose` receives. */
function build(hunks: Hunk[] = HUNKS) {
	const closed: Array<number[] | undefined> = [];
	let renders = 0;
	const component = new HunkPickerComponent({
		path: "src/a.ts",
		hunks,
		theme: fakeTheme,
		onClose: (selection) => closed.push(selection),
		requestRender: () => {
			renders += 1;
		},
		viewportRows: () => 40,
	});
	return { component, closed, renders: () => renders };
}

/** The screen as plain text. */
function text(component: HunkPickerComponent, width = 80): string {
	return stripTerminalSequences(component.render(width).join("\n"));
}

describe("HunkPickerComponent", () => {
	test("renders every hunk with its counts, all selected, and the focused preview", () => {
		const { component } = build();
		const screen = text(component);

		expect(screen).toContain("Revert hunks");
		expect(screen).toContain("2 of 2 hunks selected");
		expect(screen).toContain("src/a.ts");
		expect(screen).toContain("@@ -1,3 +1,3 @@");
		expect(screen).toContain("@@ -20,3 +20,4 @@");
		expect(screen).toContain("+1 −1");
		expect(screen).toContain("+2 −1");
		expect(screen).toContain("-old one");
		expect(screen).toContain("+new one");
	});

	test("selects everything by default, so Enter reverts the file", () => {
		const { component, closed } = build();

		component.handleInput("\r");

		expect(closed).toEqual([[0, 1]]);
	});

	test("Space toggles the focused hunk and the count follows", () => {
		const { component, closed, renders } = build();

		component.handleInput(" ");
		expect(text(component)).toContain("1 of 2 hunks selected");
		expect(renders()).toBeGreaterThan(0);

		component.handleInput("\r");
		expect(closed[0]).toEqual([1]);
	});

	test("a selects every hunk and n clears them", () => {
		const { component, closed } = build();

		component.handleInput("n");
		expect(text(component)).toContain("0 of 2 hunks selected");
		component.handleInput("a");
		expect(text(component)).toContain("2 of 2 hunks selected");

		component.handleInput("n");
		component.handleInput("\r");
		expect(closed[0]).toEqual([]);
	});

	test("Esc cancels without a selection", () => {
		const { component, closed } = build();

		component.handleInput("\u001b");

		expect(closed).toEqual([undefined]);
	});

	test("shows an empty state", () => {
		const { component } = build([]);

		expect(text(component)).toContain("No hunks to select.");
	});

	test("every line fits the width it is given", () => {
		const { component } = build([
			...HUNKS,
			{
				header: `@@ -100,3 +100,3 @@ ${"very-long-function-name-".repeat(6)}() {`,
				lines: [" context", `-${"old ".repeat(80)}`, `+${"new ".repeat(80)}`],
				added: 1,
				removed: 1,
			},
		]);

		for (const width of [40, 80, 120]) {
			for (const line of component.render(width)) {
				expect(visibleWidth(line), `${width}: ${line}`).toBeLessThanOrEqual(width);
			}
		}
	});

	test("windows a long list and reports the range", () => {
		const many: Hunk[] = Array.from({ length: 40 }, (_, index) => ({
			header: `@@ -${index * 10},3 +${index * 10},3 @@`,
			lines: [" keep", "-old", "+new", " keep"],
			added: 1,
			removed: 1,
		}));
		const component = new HunkPickerComponent({
			path: "src/a.ts",
			hunks: many,
			theme: fakeTheme,
			onClose: () => {},
			requestRender: () => {},
			viewportRows: () => 20,
		});

		expect(text(component)).toContain("of 40");
	});

	test("reserves the focused preview's real height from the visible rows", () => {
		// 14 rows: the frame spends 6, the preview's two lines and their blank line
		// cost 3, and the range row costs 1, leaving 4 rows for the list.
		const many: Hunk[] = Array.from({ length: 40 }, (_, index) => ({
			header: `@@ -${index * 10},3 +${index * 10},3 @@`,
			lines: [" keep", "-old", "+new", " keep"],
			added: 1,
			removed: 1,
		}));
		const component = new HunkPickerComponent({
			path: "src/a.ts",
			hunks: many,
			theme: fakeTheme,
			onClose: () => {},
			requestRender: () => {},
			viewportRows: () => 14,
		});

		expect(text(component)).toContain("showing 1–4 of 40");
	});
});

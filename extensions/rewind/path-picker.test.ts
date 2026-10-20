import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { PathPickerComponent } from "./path-picker.ts";
import type { ChangedPath } from "./paths.ts";

const CHANGED: ChangedPath[] = [
	{ path: "README.md", change: "modified" },
	{ path: "src/a.ts", change: "modified" },
	{ path: "src/b.ts", change: "added" },
	{ path: "src/deep/c.ts", change: "deleted" },
];

/** Mount the picker and record what `onClose` receives. */
function build(paths: ChangedPath[] = CHANGED) {
	const closed: Array<string[] | undefined> = [];
	let renders = 0;
	const component = new PathPickerComponent({
		paths,
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
function text(component: PathPickerComponent, width = 80): string {
	return stripTerminalSequences(component.render(width).join("\n"));
}

/** Move the cursor down `count` rows from the top. */
function down(component: PathPickerComponent, count: number): void {
	for (let i = 0; i < count; i++) component.handleInput("j");
}

describe("PathPickerComponent", () => {
	test("lists every changed path under its directory, with its change mark", () => {
		const { component } = build();
		const screen = text(component);

		expect(screen).toContain("Restore paths");
		expect(screen).toContain("./");
		expect(screen).toContain("src/");
		expect(screen).toContain("src/deep/");
		expect(screen).toContain("README.md");
		expect(screen).toContain("M");
		expect(screen).toContain("A");
		expect(screen).toContain("D");
		expect(screen).toContain("4 of 4 selected");
	});

	test("selects everything by default, so Enter restores what /rewind always did", () => {
		const { component, closed } = build();

		component.handleInput("\r");

		expect(closed).toEqual([CHANGED.map((entry) => entry.path)]);
	});

	test("Space toggles one file, and the count follows", () => {
		const { component, closed, renders } = build();

		// Row 0 is the root header, row 1 is README.md.
		down(component, 1);
		component.handleInput(" ");
		expect(text(component)).toContain("3 of 4 selected");
		expect(renders()).toBeGreaterThan(0);

		component.handleInput("\r");
		expect(closed[0]).toEqual(["src/a.ts", "src/b.ts", "src/deep/c.ts"]);
	});

	test("Space on a directory header toggles every file in it", () => {
		const { component, closed } = build();

		// Rows: 0 root header, 1 README, 2 src header, 3 src/a.ts, 4 src/b.ts, 5 src/deep header…
		// `src` owns its own two files; `src/deep` is a separate group.
		down(component, 2);
		component.handleInput(" ");
		expect(text(component)).toContain("2 of 4 selected");

		// Toggling it back selects the group again.
		component.handleInput(" ");
		expect(text(component)).toContain("4 of 4 selected");

		component.handleInput("\r");
		expect(closed[0]).toHaveLength(4);
	});

	test("a toggles every path back on and n clears them all", () => {
		const { component, closed } = build();

		component.handleInput("n");
		expect(text(component)).toContain("0 of 4 selected");
		component.handleInput("a");
		expect(text(component)).toContain("4 of 4 selected");

		component.handleInput("n");
		component.handleInput("\r");
		expect(closed[0]).toEqual([]);
	});

	test("Esc cancels without a selection", () => {
		const { component, closed } = build();

		component.handleInput("\u001b");

		expect(closed).toEqual([undefined]);
	});

	test("the detail line explains what the focused row does", () => {
		const { component } = build();

		down(component, 3); // src/a.ts — modified
		expect(text(component)).toContain("M — modified since the snapshot");

		down(component, 1); // src/b.ts — added
		expect(text(component)).toContain("restoring removes it");

		down(component, 2); // src/deep/c.ts — deleted
		expect(text(component)).toContain("restoring brings it back");
	});

	test("shows a rename as one R row and explains the move", () => {
		const renamed: ChangedPath[] = [{ path: "after/name.ts", change: "renamed", from: "before/name.ts" }];
		const { component, closed } = build(renamed);

		down(component, 1);
		const screen = text(component);
		expect(screen).toContain("1 of 1 selected");
		expect(screen).toContain("R");
		expect(screen).toContain("renamed from before/name.ts");

		component.handleInput("\r");
		expect(closed).toEqual([["after/name.ts"]]);
	});

	test("every line fits the width it is given", () => {
		const { component } = build([
			...CHANGED,
			{ path: `src/${"nested/".repeat(10)}deep-file-with-a-very-long-name.ts`, change: "modified" },
			{ path: "after.ts", change: "renamed", from: `src/${"deep/".repeat(8)}before.ts` },
		]);

		for (const width of [40, 80, 120]) {
			for (const line of component.render(width)) {
				expect(visibleWidth(line), `${width}: ${line}`).toBeLessThanOrEqual(width);
			}
		}
	});

	test("shows a range when the list does not fit", () => {
		const many: ChangedPath[] = Array.from({ length: 40 }, (_, index) => ({
			path: `src/file-${String(index).padStart(2, "0")}.ts`,
			change: "modified" as const,
		}));
		const component = new PathPickerComponent({
			paths: many,
			theme: fakeTheme,
			onClose: () => {},
			requestRender: () => {},
			viewportRows: () => 20,
		});

		expect(text(component)).toContain("of 41");
	});
});

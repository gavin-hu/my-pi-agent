import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme, makeRecordingTheme } from "../../test/helpers/fakes.ts";
import type { ReviewEntry } from "./paths.ts";
import {
	ReviewDiffComponent,
	ReviewListComponent,
	diffLineRole,
	type ReviewDiffAction,
	type ReviewListResult,
} from "./review-tui.ts";

const ENTRIES: ReviewEntry[] = [
	{ path: "README.md", change: "modified", added: 12, removed: 3 },
	{ path: "src/new.ts", change: "added", added: 4, removed: 0 },
	{ path: "src/old.ts", change: "deleted", added: 0, removed: 9 },
	{ path: "assets/logo.png", change: "modified", added: null, removed: null },
];

const LINES = [
	"diff --git a/README.md b/README.md",
	"index 3a1f2c9..8b4e6d0 100644",
	"--- a/README.md",
	"+++ b/README.md",
	"@@ -1 +1 @@",
	"-old line",
	"+new line",
	" context line",
];

/** Mount the list and record its close results. */
function list(overrides: Partial<ConstructorParameters<typeof ReviewListComponent>[0]> = {}) {
	const closed: ReviewListResult[] = [];
	let renders = 0;
	const component = new ReviewListComponent({
		entries: ENTRIES,
		prompt: "fix the list",
		theme: fakeTheme,
		onClose: (result) => closed.push(result),
		requestRender: () => {
			renders += 1;
		},
		viewportRows: () => 40,
		...overrides,
	});
	return { component, closed, renders: () => renders };
}

/** The screen as plain text. */
function text(component: ReviewListComponent | ReviewDiffComponent, width = 80): string {
	return stripTerminalSequences(component.render(width).join("\n"));
}

/** Mount the diff and record its close actions. */
function diff(overrides: Partial<ConstructorParameters<typeof ReviewDiffComponent>[0]> = {}) {
	const closed: Array<ReviewDiffAction | undefined> = [];
	const component = new ReviewDiffComponent({
		entry: ENTRIES[0]!,
		prompt: "fix the list",
		lines: LINES,
		theme: fakeTheme,
		onClose: (action) => closed.push(action),
		requestRender: () => {},
		viewportRows: () => 20,
		...overrides,
	});
	return { component, closed };
}

describe("ReviewListComponent", () => {
	test("renders the prompt, rows, marks, counts, checkboxes, and summary", () => {
		const { component } = list();
		const screen = text(component);

		expect(screen).toContain("Review");
		expect(screen).toContain('after "fix the list"');
		expect(screen).toContain("4 files · +16 −12 · bin");
		expect(screen).toContain("README.md");
		expect(screen).toContain("M");
		expect(screen).toContain("A");
		expect(screen).toContain("D");
		expect(screen).toContain("+12 −3");
		expect(screen).toContain("bin");
		expect(screen).toContain("◻");
		expect(screen).toContain("modified since the snapshot");
		expect(screen).not.toContain("selected");
	});

	test("Enter opens the focused file's diff and carries the selection", () => {
		const { component, closed } = list({ initialSelected: ["src/new.ts"] });

		component.handleInput("\r");

		expect(closed).toEqual([{ action: { kind: "diff", path: "README.md" }, selected: ["src/new.ts"] }]);
	});

	test("Space selects rows and r reverts the selected set", () => {
		const { component, closed } = list();

		component.handleInput("j");
		component.handleInput(" ");
		component.handleInput("j");
		component.handleInput(" ");
		expect(text(component)).toContain("2 selected");
		expect(text(component)).toContain("r reverts 2 selected files");
		component.handleInput("r");

		expect(closed.at(-1)).toEqual({
			action: { kind: "revert", paths: ["src/new.ts", "src/old.ts"] },
			selected: ["src/new.ts", "src/old.ts"],
		});
	});

	test("Space toggles a selected row off, and r falls back to the focused file", () => {
		const { component, closed } = list();

		component.handleInput(" ");
		component.handleInput(" ");
		component.handleInput("r");

		expect(closed.at(-1)).toEqual({
			action: { kind: "revert", paths: ["README.md"] },
			selected: [],
		});
	});

	test("a selects every row and n clears the set", () => {
		const { component, closed } = list();

		component.handleInput("a");
		expect(text(component)).toContain("4 selected");
		component.handleInput("n");
		expect(text(component)).not.toContain("selected");
		component.handleInput("r");

		expect(closed.at(-1)).toEqual({
			action: { kind: "revert", paths: ["README.md"] },
			selected: [],
		});
	});

	test("R reverts all without touching the selection", () => {
		const { component, closed } = list({ initialSelected: ["src/new.ts"] });

		component.handleInput("R");

		expect(closed).toEqual([{ action: { kind: "revertAll" }, selected: ["src/new.ts"] }]);
	});

	test("Esc closes with no action and returns the selection", () => {
		const { component, closed } = list({ initialSelected: ["src/new.ts"] });

		component.handleInput("\u001b");

		expect(closed).toEqual([{ action: undefined, selected: ["src/new.ts"] }]);
	});

	test("restores an initial selection and ignores paths that are gone", () => {
		const { component, closed } = list({ initialSelected: ["src/new.ts", "gone.ts"] });

		expect(text(component)).toContain("1 selected");
		component.handleInput("r");

		expect(closed.at(-1)).toEqual({
			action: { kind: "revert", paths: ["src/new.ts"] },
			selected: ["src/new.ts"],
		});
	});

	test("names committed changes in the summary and detail", () => {
		const { component } = list({ committed: true });
		const screen = text(component);

		expect(screen).toContain("committed");
		expect(screen).toContain("already committed");
		expect(screen).toContain("working tree only");
	});

	test("honours an initial index when returning from a diff", () => {
		const { component } = list({ initialIndex: 2 });
		const focused = text(component)
			.split("\n")
			.find((line) => line.includes("src/old.ts"));

		expect(focused).toContain("❯");
	});

	test("scrolls a deep initial index into view", () => {
		const many: ReviewEntry[] = Array.from({ length: 30 }, (_, index) => ({
			path: `src/file-${String(index).padStart(2, "0")}.ts`,
			change: "modified",
			added: 1,
			removed: 0,
		}));
		const { component } = list({ entries: many, initialIndex: 20, viewportRows: () => 20 });
		const screen = text(component);

		expect(screen).toContain("file-20");
		expect(screen).not.toContain("file-00");
	});

	test("renders a rename as one R row that names its source", () => {
		const renamed: ReviewEntry[] = [
			{ path: "after/name.ts", change: "renamed", from: "before/name.ts", added: 9, removed: 9 },
		];
		const { component } = list({ entries: renamed });
		const screen = text(component);

		expect(screen).toContain("1 file · +9 −9");
		expect(screen).toContain("after/name.ts");
		expect(screen).toContain("R");
		expect(screen).toContain("renamed from before/name.ts");
		expect(screen).toContain("+9 −9");
	});

	test("shows an empty state", () => {
		const { component } = list({ entries: [] });

		expect(text(component)).toContain("No changes to review.");
	});

	test("keeps every line within the width", () => {
		const long: ReviewEntry[] = [
			...ENTRIES,
			{
				path: `src/${"nested/".repeat(10)}deep-file-with-a-very-long-name.ts`,
				change: "modified",
				added: 1,
				removed: 1,
			},
		];
		const { component } = list({ entries: long, initialSelected: ["README.md"], committed: true });

		for (const width of [24, 40, 80, 120]) {
			for (const line of component.render(width)) {
				expect(visibleWidth(line), `${width}: ${line}`).toBeLessThanOrEqual(width);
			}
		}
	});

	test("windows a long list and reports the range with a selection", () => {
		const many: ReviewEntry[] = Array.from({ length: 30 }, (_, index) => ({
			path: `src/file-${String(index).padStart(2, "0")}.ts`,
			change: "modified",
			added: 1,
			removed: 0,
		}));
		const { component } = list({ entries: many, viewportRows: () => 20, initialSelected: ["src/file-00.ts"] });

		const screen = text(component);
		expect(screen).toContain("of 30");
		expect(screen).toContain("1 selected");
		expect(screen).not.toContain("file-29");
	});

	test("the wheel moves the selection", () => {
		const { component } = list();
		component.render(60);

		expect(component.handleMouse({ type: "wheel", wheelDelta: 1 } as any)).toEqual({ handled: true });
		const selected = text(component)
			.split("\n")
			.find((line) => line.startsWith("❯"));
		expect(selected).toContain("src/new.ts");
	});
});

describe("ReviewDiffComponent", () => {
	test("renders the path, counts, prompt, and patch", () => {
		const { component } = diff();
		const screen = text(component);

		expect(screen).toContain("Review");
		expect(screen).toContain("README.md");
		expect(screen).toContain("+12 −3");
		expect(screen).toContain('after "fix the list"');
		expect(screen).toContain("@@ -1 +1 @@");
		expect(screen).toContain("+new line");
		expect(screen).toContain("Esc back");
	});

	test("names committed changes in the detail", () => {
		const { component } = diff({ committed: true });
		const screen = text(component);

		expect(screen).toContain("already committed");
		expect(screen).toContain("working tree only");
	});

	test("names the rename source in the diff detail", () => {
		const entry: ReviewEntry = {
			path: "after/name.ts",
			change: "renamed",
			from: "before/name.ts",
			added: 9,
			removed: 9,
		};
		const { component } = diff({ entry });

		expect(text(component)).toContain("renamed from before/name.ts");
	});

	test("colors additions, deletions, and hunk markers by role", () => {
		const theme = makeRecordingTheme() as any;
		const { component } = diff({ theme, lines: LINES });

		component.render(80);

		expect(theme.calls.some(([color, line]: [string, string]) => color === "success" && line === "+new line")).toBe(
			true,
		);
		expect(theme.calls.some(([color, line]: [string, string]) => color === "error" && line === "-old line")).toBe(true);
		expect(theme.calls.some(([color, line]: [string, string]) => color === "accent" && line === "@@ -1 +1 @@")).toBe(
			true,
		);
	});

	test("Esc goes back and r reverts the file", () => {
		const first = diff();
		first.component.handleInput("\u001b");
		expect(first.closed).toEqual(["back"]);

		const second = diff();
		second.component.handleInput("r");
		expect(second.closed).toEqual(["revert"]);
	});

	test("offers h for hunks only when the file has textual hunks", () => {
		const selectable = diff({ canRevertHunks: true });
		expect(text(selectable.component)).toContain("h hunks");
		selectable.component.handleInput("h");
		expect(selectable.closed).toEqual(["hunks"]);

		const whole = diff();
		expect(text(whole.component)).not.toContain("h hunks");
		whole.component.handleInput("h");
		expect(whole.closed).toEqual([]);
	});

	test("scrolls from the top and reports the line range", () => {
		const lines = Array.from({ length: 100 }, (_, index) => `+line ${index}`);
		const { component } = diff({ lines, viewportRows: () => 12 });

		const first = text(component);
		expect(first).toContain("line 0");
		expect(first).toContain("line 1–");
		expect(first).toContain("of 100");

		component.handleInput("G");
		const end = text(component);
		expect(end).toContain("line 99");
		expect(end).toContain("of 100");

		component.handleInput("g");
		expect(text(component)).toContain("line 0");
	});

	test("keeps every line within the width", () => {
		const { component } = diff({ lines: [`+${"x".repeat(300)}`], committed: true });

		for (const width of [24, 40, 80, 120]) {
			for (const line of component.render(width)) {
				expect(visibleWidth(line), `${width}: ${line}`).toBeLessThanOrEqual(width);
			}
		}
	});

	test("the wheel scrolls the pane", () => {
		const lines = Array.from({ length: 100 }, (_, index) => `+line ${index}`);
		const { component } = diff({ lines, viewportRows: () => 12 });
		component.render(60);

		expect(component.handleMouse({ type: "wheel", wheelDelta: 1 } as any)).toEqual({ handled: true });
		expect(text(component)).toContain("line 3");
	});
});

describe("diffLineRole", () => {
	test("classifies headers, hunks, additions, deletions, and notes", () => {
		expect(diffLineRole("diff --git a/x b/x")).toBe("meta");
		expect(diffLineRole("--- a/x")).toBe("meta");
		expect(diffLineRole("+++ b/x")).toBe("meta");
		expect(diffLineRole("@@ -1 +1 @@")).toBe("accent");
		expect(diffLineRole("+added")).toBe("ok");
		expect(diffLineRole("-removed")).toBe("bad");
		expect(diffLineRole(" context")).toBe("label");
		expect(diffLineRole("… diff truncated")).toBe("warn");
	});
});

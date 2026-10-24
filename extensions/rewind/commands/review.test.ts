import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripTerminalSequences, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { PLAN_MODE_ENTRY_TYPE } from "../../../lib/plan-state.ts";
import { fakeTheme, makeRecordingTheme } from "../../../test/helpers/fakes.ts";
import { cleanup, makeRepo } from "../../../test/helpers/git.ts";
import { runSlowSuites } from "../../../test/helpers/slow-suite.ts";
import {
	branchWithUser,
	makeCtx,
	primeRewind,
	rewindMetadata,
	rewindRefs,
	runGit,
	setupRewind,
	snapshotInput,
	WRITE_TOOL,
} from "../../../test/helpers/fixtures/rewind.ts";
import { HunkPickerComponent } from "../view/hunk-picker.ts";
import { buildHunkPatch, parseFilePatch, type Hunk } from "../text/patch.ts";
import { PathPickerComponent } from "../view/path-picker.ts";
import {
	baseName,
	entryPaths,
	expandGroup,
	groupPaths,
	parseNameStatus,
	parseNumStat,
	SELECTION_MARKS,
	summarize,
	toReviewEntries,
	type ChangedPath,
	type ReviewEntry,
} from "../text/paths.ts";
import {
	ReviewDiffComponent,
	ReviewListComponent,
	diffLineRole,
	type ReviewDiffAction,
	type ReviewListResult,
} from "../view/review-tui.ts";
import { createSnapshot } from "../transport/snapshot.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

describe("changed paths", () => {
	test("reads each status letter into its change kind", () => {
		const changed = parseNameStatus(["M\tsrc/a.ts", "D\told.ts", "A\tnew.ts", "T\tbin/tool"].join("\n"));

		expect(changed).toEqual([
			{ path: "src/a.ts", change: "modified" },
			{ path: "old.ts", change: "deleted" },
			{ path: "new.ts", change: "added" },
			{ path: "bin/tool", change: "modified" },
		]);
	});

	test("pairs a rename into one entry with its source", () => {
		expect(parseNameStatus("R100\tbefore/name.ts\tafter/name.ts")).toEqual([
			{ path: "after/name.ts", change: "renamed", from: "before/name.ts" },
		]);
	});

	test("expands a copy into its created path only", () => {
		expect(parseNameStatus("C75\ta.ts\tb.ts")).toEqual([{ path: "b.ts", change: "added" }]);
	});

	test("skips blank lines, unknown statuses, and a truncated rename", () => {
		expect(parseNameStatus("\nU\tconflict.ts\n\nM\tok.ts\n")).toEqual([{ path: "ok.ts", change: "modified" }]);
		expect(parseNameStatus("R100\tonly-one.ts")).toEqual([]);
	});

	test("groups by directory with the root first and files sorted inside", () => {
		const changed = parseNameStatus(
			["M\tsrc/b.ts", "A\tsrc/deep/c.ts", "D\troot.ts", "M\tsrc/a.ts", "M\tlib/z.ts"].join("\n"),
		);

		const groups = groupPaths(changed);

		expect(groups.map((group) => group.dir)).toEqual(["", "lib", "src", "src/deep"]);
		expect(groups[2]?.paths.map((entry) => baseName(entry.path))).toEqual(["a.ts", "b.ts"]);
		expect(groups[0]?.paths).toEqual([{ path: "root.ts", change: "deleted" }]);
		expect(groupPaths([])).toEqual([]);
	});

	test("expands a group to every file in the directory", () => {
		const [root] = groupPaths(parseNameStatus(["D\troot.ts", "M\tlib/a.ts"].join("\n")));

		expect(expandGroup(root!)).toEqual(["root.ts"]);
	});

	test("names both sides of a rename and just the path otherwise", () => {
		expect(entryPaths({ path: "after.ts", change: "renamed", from: "before.ts" })).toEqual(["before.ts", "after.ts"]);
		expect(entryPaths({ path: "only.ts", change: "modified" })).toEqual(["only.ts"]);
	});

	test("counts modified and deleted as changed, and added as removed", () => {
		const changed = parseNameStatus(["M\ta.ts", "D\tb.ts", "A\tc.ts", "A\td.ts"].join("\n"));

		expect(summarize(changed)).toEqual({ changed: 2, removed: 2 });
	});

	test("counts a rename once, not as a change plus a creation", () => {
		expect(summarize(parseNameStatus("R100\tbefore.ts\tafter.ts"))).toEqual({ changed: 1, removed: 0 });
		expect(summarize([])).toEqual({ changed: 0, removed: 0 });
	});

	test("gives every change kind its own one-column mark", () => {
		const marks = ["modified", "deleted", "added", "renamed"] as const;

		expect(new Set(marks.map((change) => SELECTION_MARKS[change])).size).toBe(marks.length);
	});

	test("reads text counts, binary dashes, and a path containing a tab", () => {
		const stats = parseNumStat("12\t3\tsrc/a.ts\n-\t-\tassets/logo.png\n0\t0\tempty.txt\n1\t2\tdir/weird\tname.txt");

		expect(stats.get("src/a.ts")).toEqual({ added: 12, removed: 3 });
		expect(stats.get("assets/logo.png")).toEqual({ added: null, removed: null });
		expect(stats.get("empty.txt")).toEqual({ added: 0, removed: 0 });
		expect(stats.get("dir/weird\tname.txt")).toEqual({ added: 1, removed: 2 });
	});

	test("skips blank and malformed numstat lines", () => {
		expect(parseNumStat("\nnot-a-stat\n1\t2\n10\tnot-a-number\tx.txt\n")).toEqual(new Map());
	});

	test("sorts review entries by path and attaches counts, defaulting to null", () => {
		const entries = toReviewEntries(
			parseNameStatus("M\tsrc/b.ts\nA\tsrc/a.ts\nD\tz.ts"),
			parseNumStat("4\t1\tsrc/b.ts"),
		);

		expect(entries.map((entry) => entry.path)).toEqual(["src/a.ts", "src/b.ts", "z.ts"]);
		expect(entries.map((entry) => [entry.added, entry.removed])).toEqual([
			[null, null],
			[4, 1],
			[null, null],
		]);
	});

	test("joins a rename's added lines from its destination and removed lines from its source", () => {
		const entries = toReviewEntries(
			parseNameStatus("R100\tbefore.ts\tafter.ts"),
			parseNumStat("0\t9\tbefore.ts\n9\t0\tafter.ts"),
		);

		expect(entries).toEqual([{ path: "after.ts", change: "renamed", from: "before.ts", added: 9, removed: 9 }]);
	});
});

const PATCH = [
	"diff --git a/src/a.ts b/src/a.ts",
	"index 1111111..2222222 100644",
	"--- a/src/a.ts",
	"+++ b/src/a.ts",
	"@@ -1,3 +1,3 @@ function one() {",
	" keep",
	"-old one",
	"+new one",
	" keep",
	"@@ -20,3 +20,4 @@ function two() {",
	" keep",
	"-old two",
	"+new two",
	"+extra",
	" tail",
	"\\ No newline at end of file",
].join("\n");

describe("single-file patch", () => {
	test("splits the file header from its hunks and counts each body", () => {
		const patch = parseFilePatch(PATCH);

		expect(patch?.header).toEqual([
			"diff --git a/src/a.ts b/src/a.ts",
			"index 1111111..2222222 100644",
			"--- a/src/a.ts",
			"+++ b/src/a.ts",
		]);
		expect(patch?.hunks.map((hunk) => hunk.header)).toEqual([
			"@@ -1,3 +1,3 @@ function one() {",
			"@@ -20,3 +20,4 @@ function two() {",
		]);
		expect(patch?.hunks.map((hunk) => [hunk.added, hunk.removed])).toEqual([
			[1, 1],
			[2, 1],
		]);
		expect(patch?.hunks[1]?.lines.at(-1)).toBe("\\ No newline at end of file");
	});

	test("keeps a carriage return inside a body line", () => {
		const patch = parseFilePatch(PATCH.replace("+new one", "+new one\r"));

		expect(patch?.hunks[0]?.lines).toContain("+new one\r");
	});

	test("rejects a binary patch, a mode-only change, and a headerless diff", () => {
		expect(parseFilePatch(["diff --git a/x b/x", "Binary files a/x and b/x differ", ""].join("\n"))).toBeUndefined();
		expect(parseFilePatch(["diff --git a/x b/x", "old mode 100644", "new mode 100755", ""].join("\n"))).toBeUndefined();
		expect(parseFilePatch("@@ -1 +1 @@\n-a\n+b\n")).toBeUndefined();
	});

	test("rejects a patch that spans two files", () => {
		const multi = [PATCH, "diff --git a/src/b.ts b/src/b.ts", "--- a/src/b.ts", "+++ b/src/b.ts"].join("\n");

		expect(parseFilePatch(multi)).toBeUndefined();
	});

	test("rebuilds a patch from the chosen hunks only, with a trailing newline", () => {
		const patch = parseFilePatch(PATCH);
		expect(patch).toBeDefined();
		if (!patch) return;

		const built = buildHunkPatch(patch, [1]);

		expect(built.startsWith("diff --git a/src/a.ts b/src/a.ts\n")).toBe(true);
		expect(built).toContain("@@ -20,3 +20,4 @@ function two() {");
		expect(built).not.toContain("@@ -1,3 +1,3 @@");
		expect(built.endsWith("\n")).toBe(true);
	});

	test("dedupes and orders chosen hunks, dropping out-of-range indices", () => {
		const patch = parseFilePatch(PATCH);
		expect(patch).toBeDefined();
		if (!patch) return;

		const built = buildHunkPatch(patch, [1, 0, 1, -1, 9]);

		expect(built.indexOf("@@ -1,3 +1,3 @@")).toBeLessThan(built.indexOf("@@ -20,3 +20,4 @@"));
		expect(built.split("@@ -1,3 +1,3 @@")).toHaveLength(2);
		expect(built.split("@@ -20,3 +20,4 @@")).toHaveLength(2);
	});
});

const ENTRIES: ReviewEntry[] = [
	{ path: "README.md", change: "modified", added: 12, removed: 3 },
	{ path: "src/new.ts", change: "added", added: 4, removed: 0 },
	{ path: "src/old.ts", change: "deleted", added: 0, removed: 9 },
	{ path: "assets/logo.png", change: "modified", added: null, removed: null },
];

const DIFF_LINES = [
	"diff --git a/README.md b/README.md",
	"index 3a1f2c9..8b4e6d0 100644",
	"--- a/README.md",
	"+++ b/README.md",
	"@@ -1 +1 @@",
	"-old line",
	"+new line",
	" context line",
];

function listComponent(overrides: Partial<ConstructorParameters<typeof ReviewListComponent>[0]> = {}) {
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

function diffComponent(overrides: Partial<ConstructorParameters<typeof ReviewDiffComponent>[0]> = {}) {
	const closed: Array<ReviewDiffAction | undefined> = [];
	const component = new ReviewDiffComponent({
		entry: ENTRIES[0]!,
		prompt: "fix the list",
		lines: DIFF_LINES,
		theme: fakeTheme,
		onClose: (action) => closed.push(action),
		requestRender: () => {},
		viewportRows: () => 20,
		...overrides,
	});
	return { component, closed };
}

function screenText(component: Component, width = 80): string {
	return stripTerminalSequences(component.render(width).join("\n"));
}

describe("review list", () => {
	test("renders the prompt, rows, marks, counts, selection boxes, and summary", () => {
		const screen = screenText(listComponent().component);

		expect(screen).toContain('after "fix the list"');
		expect(screen).toContain("4 files");
		expect(screen).toContain("+16 −12");
		expect(screen).toContain("bin");
		expect(screen).toContain("README.md");
		expect(screen).toContain("M");
		expect(screen).toContain("A");
		expect(screen).toContain("D");
		expect(screen).toContain("+12 −3");
		expect(screen).toContain("◻");
		expect(screen).toContain("modified since the snapshot");
		expect(screen).not.toContain("selected");
	});

	test("Enter opens the focused file's diff and carries the selection", () => {
		const { component, closed } = listComponent({ initialSelected: ["src/new.ts"] });

		component.handleInput("\r");

		expect(closed).toEqual([{ action: { kind: "diff", path: "README.md" }, selected: ["src/new.ts"] }]);
	});

	test("Space selects rows and r reverts the selected set", () => {
		const { component, closed } = listComponent();

		component.handleInput("j");
		component.handleInput(" ");
		component.handleInput("j");
		component.handleInput(" ");
		expect(screenText(component)).toContain("2 selected");
		component.handleInput("r");

		expect(closed.at(-1)).toEqual({
			action: { kind: "revert", paths: ["src/new.ts", "src/old.ts"] },
			selected: ["src/new.ts", "src/old.ts"],
		});
	});

	test("Space toggles a selected row off, and r falls back to the focused file", () => {
		const { component, closed } = listComponent();

		component.handleInput(" ");
		component.handleInput(" ");
		component.handleInput("r");

		expect(closed.at(-1)).toEqual({ action: { kind: "revert", paths: ["README.md"] }, selected: [] });
	});

	test("a selects every row and n clears the set", () => {
		const { component, closed } = listComponent();

		component.handleInput("a");
		expect(screenText(component)).toContain("4 selected");
		component.handleInput("n");
		expect(screenText(component)).not.toContain("selected");
		component.handleInput("r");

		expect(closed.at(-1)).toEqual({ action: { kind: "revert", paths: ["README.md"] }, selected: [] });
	});

	test("R reverts all without touching the selection", () => {
		const { component, closed } = listComponent({ initialSelected: ["src/new.ts"] });

		component.handleInput("R");

		expect(closed).toEqual([{ action: { kind: "revertAll" }, selected: ["src/new.ts"] }]);
	});

	test("Esc closes with no action and returns the selection", () => {
		const { component, closed } = listComponent({ initialSelected: ["src/new.ts"] });

		component.handleInput("\u001b");

		expect(closed).toEqual([{ action: undefined, selected: ["src/new.ts"] }]);
	});

	test("restores an initial selection and drops paths that are gone", () => {
		const { component, closed } = listComponent({ initialSelected: ["src/new.ts", "gone.ts"] });

		expect(screenText(component)).toContain("1 selected");
		component.handleInput("r");

		expect(closed.at(-1)).toEqual({
			action: { kind: "revert", paths: ["src/new.ts"] },
			selected: ["src/new.ts"],
		});
	});

	test("names committed changes in the summary and detail", () => {
		const screen = screenText(listComponent({ committed: true }).component);

		expect(screen).toContain("committed");
		expect(screen).toContain("already committed");
		expect(screen).toContain("working tree only");
	});

	test("scrolls a deep initial index into view", () => {
		const many: ReviewEntry[] = Array.from({ length: 30 }, (_, index) => ({
			path: `src/file-${String(index).padStart(2, "0")}.ts`,
			change: "modified",
			added: 1,
			removed: 0,
		}));

		const screen = screenText(listComponent({ entries: many, initialIndex: 20, viewportRows: () => 20 }).component);

		expect(screen).toContain("file-20");
		expect(screen).not.toContain("file-00");
	});

	test("renders a rename as one R row that names its source", () => {
		const renamed: ReviewEntry[] = [
			{ path: "after/name.ts", change: "renamed", from: "before/name.ts", added: 9, removed: 9 },
		];

		const screen = screenText(listComponent({ entries: renamed }).component);

		expect(screen).toContain("1 file");
		expect(screen).toContain("+9 −9");
		expect(screen).toContain("after/name.ts");
		expect(screen).toContain("R");
		expect(screen).toContain("renamed from before/name.ts");
	});

	test("shows an empty state", () => {
		expect(screenText(listComponent({ entries: [] }).component)).toContain("No changes to review.");
	});

	test("keeps every line within the width it is given", () => {
		const long: ReviewEntry[] = [
			...ENTRIES,
			{
				path: `src/${"nested/".repeat(10)}deep-file-with-a-very-long-name.ts`,
				change: "modified",
				added: 1,
				removed: 1,
			},
		];
		const { component } = listComponent({ entries: long, initialSelected: ["README.md"], committed: true });

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

		const screen = screenText(
			listComponent({ entries: many, viewportRows: () => 20, initialSelected: ["src/file-00.ts"] }).component,
		);

		expect(screen).toContain("of 30");
		expect(screen).toContain("1 selected");
		expect(screen).not.toContain("file-29");
	});

	test("the wheel moves the selection", () => {
		const { component } = listComponent();
		component.render(60);

		expect(component.handleMouse({ type: "wheel", wheelDelta: 1 } as any)).toEqual({ handled: true });
		const selected = screenText(component)
			.split("\n")
			.find((line) => line.startsWith("❯"));
		expect(selected).toContain("src/new.ts");
	});
});

describe("review diff", () => {
	test("renders the path, counts, prompt, patch, and scroll hint", () => {
		const screen = screenText(diffComponent().component);

		expect(screen).toContain("README.md");
		expect(screen).toContain("+12 −3");
		expect(screen).toContain('after "fix the list"');
		expect(screen).toContain("@@ -1 +1 @@");
		expect(screen).toContain("+new line");
		expect(screen).toContain("Esc back");
	});

	test("names committed changes in the detail", () => {
		const screen = screenText(diffComponent({ committed: true }).component);

		expect(screen).toContain("already committed");
		expect(screen).toContain("working tree only");
	});

	test("names the rename source in the detail", () => {
		const entry: ReviewEntry = {
			path: "after/name.ts",
			change: "renamed",
			from: "before/name.ts",
			added: 9,
			removed: 9,
		};

		expect(screenText(diffComponent({ entry }).component)).toContain("renamed from before/name.ts");
	});

	test("colors additions, deletions, and hunk markers by role", () => {
		const theme = makeRecordingTheme() as any;

		diffComponent({ theme, lines: DIFF_LINES }).component.render(80);

		expect(theme.calls.some(([color, line]: [string, string]) => color === "success" && line === "+new line")).toBe(
			true,
		);
		expect(theme.calls.some(([color, line]: [string, string]) => color === "error" && line === "-old line")).toBe(true);
		expect(theme.calls.some(([color, line]: [string, string]) => color === "accent" && line === "@@ -1 +1 @@")).toBe(
			true,
		);
	});

	test("Esc goes back and r reverts the file", () => {
		const back = diffComponent();
		back.component.handleInput("\u001b");
		expect(back.closed).toEqual(["back"]);

		const revert = diffComponent();
		revert.component.handleInput("r");
		expect(revert.closed).toEqual(["revert"]);
	});

	test("offers h for hunks only when the file has textual hunks", () => {
		const selectable = diffComponent({ canRevertHunks: true });
		expect(screenText(selectable.component)).toContain("h hunks");
		selectable.component.handleInput("h");
		expect(selectable.closed).toEqual(["hunks"]);

		const whole = diffComponent();
		expect(screenText(whole.component)).not.toContain("h hunks");
		whole.component.handleInput("h");
		expect(whole.closed).toEqual([]);
	});

	test("scrolls from the first line and reports the line range", () => {
		const lines = Array.from({ length: 100 }, (_, index) => `+line ${index}`);
		const { component } = diffComponent({ lines, viewportRows: () => 12 });

		const first = screenText(component);
		expect(first).toContain("line 0");
		expect(first).toContain("of 100");

		component.handleInput("G");
		const end = screenText(component);
		expect(end).toContain("line 99");
		expect(end).toContain("of 100");

		component.handleInput("g");
		expect(screenText(component)).toContain("line 0");
	});

	test("keeps every line within the width it is given", () => {
		const { component } = diffComponent({ lines: [`+${"x".repeat(300)}`], committed: true });

		for (const width of [24, 40, 80, 120]) {
			for (const line of component.render(width)) {
				expect(visibleWidth(line), `${width}: ${line}`).toBeLessThanOrEqual(width);
			}
		}
	});

	test("the wheel scrolls the pane", () => {
		const lines = Array.from({ length: 100 }, (_, index) => `+line ${index}`);
		const { component } = diffComponent({ lines, viewportRows: () => 12 });
		component.render(60);

		expect(component.handleMouse({ type: "wheel", wheelDelta: 1 } as any)).toEqual({ handled: true });
		expect(screenText(component)).toContain("line 3");
	});

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

function hunkPicker(hunks: Hunk[] = HUNKS, viewportRows = () => 40) {
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
		viewportRows,
	});
	return { component, closed, renders: () => renders };
}

describe("hunk checklist", () => {
	test("renders every hunk with its counts, all selected, and the focused preview", () => {
		const screen = screenText(hunkPicker().component);

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

	test("selects everything by default, so Enter reverts the whole file", () => {
		const { component, closed } = hunkPicker();

		component.handleInput("\r");

		expect(closed).toEqual([[0, 1]]);
	});

	test("Space toggles the focused hunk and the count follows", () => {
		const { component, closed, renders } = hunkPicker();

		component.handleInput(" ");
		expect(screenText(component)).toContain("1 of 2 hunks selected");
		expect(renders()).toBeGreaterThan(0);

		component.handleInput("\r");
		expect(closed[0]).toEqual([1]);
	});

	test("a selects every hunk and n clears them", () => {
		const { component, closed } = hunkPicker();

		component.handleInput("n");
		expect(screenText(component)).toContain("0 of 2 hunks selected");
		component.handleInput("a");
		expect(screenText(component)).toContain("2 of 2 hunks selected");

		component.handleInput("n");
		component.handleInput("\r");
		expect(closed[0]).toEqual([]);
	});

	test("Esc cancels without a selection", () => {
		const { component, closed } = hunkPicker();

		component.handleInput("\u001b");

		expect(closed).toEqual([undefined]);
	});

	test("shows an empty state", () => {
		expect(screenText(hunkPicker([]).component)).toContain("No hunks to select.");
	});

	test("keeps every line within the width it is given", () => {
		const { component } = hunkPicker([
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

		expect(screenText(hunkPicker(many, () => 20).component)).toContain("of 40");
	});

	test("reserves the focused preview's height from the visible rows", () => {
		// 14 rows: the frame spends 6, the preview's two lines and their blank line
		// cost 3, and the range row costs 1, leaving 4 rows for the list.
		const many: Hunk[] = Array.from({ length: 40 }, (_, index) => ({
			header: `@@ -${index * 10},3 +${index * 10},3 @@`,
			lines: [" keep", "-old", "+new", " keep"],
			added: 1,
			removed: 1,
		}));

		expect(screenText(hunkPicker(many, () => 14).component)).toContain("showing 1–4 of 40");
	});
});

const CHANGED: ChangedPath[] = [
	{ path: "README.md", change: "modified" },
	{ path: "src/a.ts", change: "modified" },
	{ path: "src/b.ts", change: "added" },
	{ path: "src/deep/c.ts", change: "deleted" },
];

function pathPicker(paths: ChangedPath[] = CHANGED, viewportRows = () => 40) {
	const closed: Array<string[] | undefined> = [];
	let renders = 0;
	const component = new PathPickerComponent({
		paths,
		theme: fakeTheme,
		onClose: (selection) => closed.push(selection),
		requestRender: () => {
			renders += 1;
		},
		viewportRows,
	});
	return { component, closed, renders: () => renders };
}

function down(component: PathPickerComponent, count: number): void {
	for (let i = 0; i < count; i++) component.handleInput("j");
}

describe("path checklist", () => {
	test("lists every changed path under its directory, with its change mark", () => {
		const screen = screenText(pathPicker().component);

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

	test("selects everything by default, so Enter restores the whole tree", () => {
		const { component, closed } = pathPicker();

		component.handleInput("\r");

		expect(closed).toEqual([CHANGED.map((entry) => entry.path)]);
	});

	test("Space toggles one file, and the count follows", () => {
		const { component, closed, renders } = pathPicker();

		// Row 0 is the root header, row 1 is README.md.
		down(component, 1);
		component.handleInput(" ");
		expect(screenText(component)).toContain("3 of 4 selected");
		expect(renders()).toBeGreaterThan(0);

		component.handleInput("\r");
		expect(closed[0]).toEqual(["src/a.ts", "src/b.ts", "src/deep/c.ts"]);
	});

	test("Space on a directory header toggles every file in it", () => {
		const { component, closed } = pathPicker();

		// Rows: 0 root header, 1 README, 2 src header, 3 src/a.ts, 4 src/b.ts, 5 src/deep header…
		down(component, 2);
		component.handleInput(" ");
		expect(screenText(component)).toContain("2 of 4 selected");

		component.handleInput(" ");
		expect(screenText(component)).toContain("4 of 4 selected");

		component.handleInput("\r");
		expect(closed[0]).toHaveLength(4);
	});

	test("a toggles every path back on and n clears them all", () => {
		const { component, closed } = pathPicker();

		component.handleInput("n");
		expect(screenText(component)).toContain("0 of 4 selected");
		component.handleInput("a");
		expect(screenText(component)).toContain("4 of 4 selected");

		component.handleInput("n");
		component.handleInput("\r");
		expect(closed[0]).toEqual([]);
	});

	test("Esc cancels without a selection", () => {
		const { component, closed } = pathPicker();

		component.handleInput("\u001b");

		expect(closed).toEqual([undefined]);
	});

	test("the detail line explains what the focused row does", () => {
		const { component } = pathPicker();

		down(component, 3); // src/a.ts — modified
		expect(screenText(component)).toContain("M — modified since the snapshot");

		down(component, 1); // src/b.ts — added
		expect(screenText(component)).toContain("restoring removes it");

		down(component, 2); // src/deep/c.ts — deleted
		expect(screenText(component)).toContain("restoring brings it back");
	});

	test("shows a rename as one R row and explains the move", () => {
		const renamed: ChangedPath[] = [{ path: "after/name.ts", change: "renamed", from: "before/name.ts" }];
		const { component, closed } = pathPicker(renamed);

		down(component, 1);
		const screen = screenText(component);
		expect(screen).toContain("1 of 1 selected");
		expect(screen).toContain("R");
		expect(screen).toContain("renamed from before/name.ts");

		component.handleInput("\r");
		expect(closed).toEqual([["after/name.ts"]]);
	});

	test("keeps every line within the width it is given", () => {
		const { component } = pathPicker([
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

		expect(screenText(pathPicker(many, () => 20).component)).toContain("of 41");
	});
});

/** One recorded list close: an optional action and the selection it carried. */
function screen(action?: ReviewListResult["action"], selected: string[] = []): ReviewListResult {
	return { action, selected };
}

/** Script the custom screens and run `/review`, returning how many mounted. */
async function runReview(ctx: any, actions: unknown[]): Promise<number> {
	const queue = [...actions];
	let mounts = 0;
	ctx.ui.custom = async (_factory: unknown) => {
		mounts += 1;
		return queue.shift();
	};
	await ctx.command.handler("", ctx);
	return mounts;
}

/** A branch with two user prompts, for the latest-snapshot test. */
function twoPromptBranch() {
	return [
		...branchWithUser("e1", "first task"),
		{
			type: "message",
			id: "e2",
			parentId: "e1",
			timestamp: "1970-01-01T00:00:02.000Z",
			message: { role: "user", content: "second task", timestamp: 2000 },
		},
	];
}

async function reviewCtx(repo: string, branch: unknown[] = branchWithUser("e1")) {
	const fake = setupRewind([WRITE_TOOL]);
	const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "tui", branch, sessionId: "s1" });
	ctx.command = fake.commands.get("review");
	await primeRewind(fake, ctx);
	return ctx;
}

describe.skipIf(!runSlowSuites)("/review command", () => {
	test("reverts one changed file and leaves the safety snapshot behind", async () => {
		const repo = await makeRepo("pi-rw-review-one-");
		cleanups.push(repo);
		const ctx = await reviewCtx(repo);
		writeFileSync(join(repo, "README.md"), "changed\n");

		const mounts = await runReview(ctx, [screen({ kind: "revert", paths: ["after.txt"] }), screen()]);

		expect(mounts).toBe(2);
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("changed\n");
		expect(ctx.confirms.at(-1)?.title).toContain("after.txt");
		expect(ctx.notices.at(-1)?.message).toContain("Reverted 1 file");
		expect(await rewindRefs(repo)).toHaveLength(2);
		expect((await rewindMetadata(repo)).some((meta) => meta.reason === "pre-restore")).toBe(true);
	});

	test("reverts a selection as one restore with one safety snapshot", async () => {
		const repo = await makeRepo("pi-rw-review-batch-");
		cleanups.push(repo);
		const ctx = await reviewCtx(repo);
		writeFileSync(join(repo, "README.md"), "changed\n");
		writeFileSync(join(repo, "third.txt"), "third\n");

		const mounts = await runReview(ctx, [
			screen({ kind: "revert", paths: ["README.md", "after.txt"] }, ["README.md", "after.txt"]),
			screen(),
		]);

		expect(mounts).toBe(2);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
		expect(existsSync(join(repo, "third.txt"))).toBe(true);
		expect(ctx.confirms.at(-1)?.title).toContain("2 selected files");
		expect(ctx.confirms.at(-1)?.message).toContain("Other changed files stay as they are");
		expect(ctx.notices.at(-1)?.message).toContain("Reverted 2 files");
		// One automatic snapshot plus one pre-restore snapshot for the batch.
		expect(await rewindRefs(repo)).toHaveLength(2);
	});

	test("names committed changes and leaves the commit in place", async () => {
		const repo = await makeRepo("pi-rw-review-committed-");
		cleanups.push(repo);
		const ctx = await reviewCtx(repo);
		rmSync(join(repo, "after.txt"));
		writeFileSync(join(repo, "README.md"), "changed\n");
		await runGit(["add", "-A"], { cwd: repo });
		await runGit(["commit", "-qm", "turn"], { cwd: repo });

		const mounts = await runReview(ctx, [screen({ kind: "revert", paths: ["README.md"] })]);

		expect(mounts).toBe(1);
		expect(ctx.confirms.at(-1)?.message).toContain("already committed");
		expect(ctx.confirms.at(-1)?.message).toContain("leaves the commits in place");
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect((await runGit(["log", "-1", "--format=%s"], { cwd: repo })).stdout.trim()).toBe("turn");
		expect((await runGit(["status", "--short"], { cwd: repo })).stdout).toContain("README.md");
		expect(await rewindRefs(repo)).toHaveLength(2);
	});

	test("reverts every changed path with R", async () => {
		const repo = await makeRepo("pi-rw-review-all-");
		cleanups.push(repo);
		const ctx = await reviewCtx(repo);
		writeFileSync(join(repo, "README.md"), "changed\n");

		await runReview(ctx, [screen({ kind: "revertAll" })]);

		expect(existsSync(join(repo, "after.txt"))).toBe(false);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(ctx.confirms.at(-1)?.title).toContain("all");
		expect(ctx.notices.at(-1)?.message).toContain("No changes remain.");
	});

	test("reverts a rename as one row, restoring both sides", async () => {
		const repo = await makeRepo("pi-rw-review-rename-");
		cleanups.push(repo);
		const ctx = await reviewCtx(repo);
		await runGit(["mv", "README.md", "renamed.md"], { cwd: repo });

		const mounts = await runReview(ctx, [screen({ kind: "revert", paths: ["renamed.md"] }), screen()]);

		expect(mounts).toBe(2);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(existsSync(join(repo, "renamed.md"))).toBe(false);
		// The unrelated creation stays until it is reverted on its own.
		expect(existsSync(join(repo, "after.txt"))).toBe(true);
		expect(ctx.confirms.at(-1)?.message).toContain("renamed from README.md");
		expect(ctx.notices.at(-1)?.message).toContain("Reverted 1 file");
	});

	test("R reverts a rename together with the other changes", async () => {
		const repo = await makeRepo("pi-rw-review-rename-all-");
		cleanups.push(repo);
		const ctx = await reviewCtx(repo);
		await runGit(["mv", "README.md", "renamed.md"], { cwd: repo });

		await runReview(ctx, [screen({ kind: "revertAll" })]);

		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(existsSync(join(repo, "renamed.md"))).toBe(false);
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
		expect(ctx.notices.at(-1)?.message).toContain("No changes remain.");
	});

	test("reverts only the chosen hunk of a modified file", async () => {
		const repo = await makeRepo("pi-rw-review-hunks-");
		cleanups.push(repo);
		const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
		writeFileSync(join(repo, "two.txt"), `${lines.join("\n")}\n`);
		await runGit(["add", "."], { cwd: repo });
		await runGit(["commit", "-qm", "base"], { cwd: repo });

		const ctx = await reviewCtx(repo);
		const changed = lines.map((line, index) => (index === 1 ? "changed one" : index === 15 ? "changed two" : line));
		writeFileSync(join(repo, "two.txt"), `${changed.join("\n")}\n`);

		const mounts = await runReview(ctx, [screen({ kind: "diff", path: "two.txt" }), "hunks", [0], screen()]);

		expect(mounts).toBe(4);
		const after = readFileSync(join(repo, "two.txt"), "utf-8").split("\n");
		expect(after[1]).toBe("line 2");
		expect(after[15]).toBe("changed two");
		expect(existsSync(join(repo, "after.txt"))).toBe(true);
		expect(ctx.confirms.at(-1)?.title).toContain("1 hunk");
		expect(ctx.confirms.at(-1)?.message).toContain("1 of 2 hunks");
		expect(ctx.notices.at(-1)?.message).toContain("Reverted 1 hunk in two.txt");
		// The automatic snapshot plus one pre-restore safety snapshot.
		expect(await rewindRefs(repo)).toHaveLength(2);
	});

	test("a declined confirmation leaves the file and reopens the list", async () => {
		const repo = await makeRepo("pi-rw-review-cancel-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
			confirm: false,
		});
		ctx.command = fake.commands.get("review");
		await primeRewind(fake, ctx);

		await runReview(ctx, [screen({ kind: "revert", paths: ["after.txt"] }), screen()]);

		expect(existsSync(join(repo, "after.txt"))).toBe(true);
		expect(ctx.notices.some((notice: { message: string }) => notice.message.includes("Reverted"))).toBe(false);
	});

	test("opens a diff, goes back, then reverts from the diff", async () => {
		const repo = await makeRepo("pi-rw-review-diff-");
		cleanups.push(repo);
		const ctx = await reviewCtx(repo);
		writeFileSync(join(repo, "README.md"), "changed\n");

		const mounts = await runReview(ctx, [
			screen({ kind: "diff", path: "README.md" }),
			"back",
			screen({ kind: "diff", path: "README.md" }),
			"revert",
			screen(),
		]);

		expect(mounts).toBe(5);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(ctx.notices.at(-1)?.message).toContain("Reverted 1 file");
	});

	test("uses the newest prompt's snapshot, not an older one", async () => {
		const repo = await makeRepo("pi-rw-review-latest-");
		cleanups.push(repo);
		await createSnapshot(
			{ runGit, now: () => 1000, idFactory: () => "first" },
			snapshotInput(repo, { entryId: "e1", sessionId: "s1" }),
		);
		writeFileSync(join(repo, "first.txt"), "first\n");
		await createSnapshot(
			{ runGit, now: () => 2000, idFactory: () => "second" },
			snapshotInput(repo, { entryId: "e2", sessionId: "s1" }),
		);
		writeFileSync(join(repo, "second.txt"), "second\n");

		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: twoPromptBranch(),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");

		await runReview(ctx, [screen({ kind: "revert", paths: ["second.txt"] }), screen()]);

		expect(existsSync(join(repo, "second.txt"))).toBe(false);
		expect(existsSync(join(repo, "first.txt"))).toBe(true);
	});

	test("reports when no prompt has a code snapshot", async () => {
		const repo = await makeRepo("pi-rw-review-none-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");

		const mounts = await runReview(ctx, []);

		expect(mounts).toBe(0);
		expect(ctx.notices.at(-1)?.message).toContain("No prompt with a code snapshot");
	});

	test("reports when nothing changed since the snapshot", async () => {
		const repo = await makeRepo("pi-rw-review-clean-");
		cleanups.push(repo);
		const ctx = await reviewCtx(repo);
		rmSync(join(repo, "after.txt"));

		const mounts = await runReview(ctx, []);

		expect(mounts).toBe(0);
		expect(ctx.notices.at(-1)?.message).toContain("No changes since the snapshot");
	});

	test("refuses while plan mode is on", async () => {
		const repo = await makeRepo("pi-rw-review-plan-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: [...branchWithUser("e1"), { type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } }],
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");

		const mounts = await runReview(ctx, []);

		expect(mounts).toBe(0);
		expect(ctx.notices.at(-1)?.message).toContain("Plan mode is read-only");
	});

	test("prints the changed list outside the TUI", async () => {
		const repo = await makeRepo("pi-rw-review-print-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: false,
			mode: "print",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");
		await primeRewind(fake, ctx);

		const mounts = await runReview(ctx, []);

		expect(mounts).toBe(0);
		expect(ctx.notices.at(-1)?.message).toContain('Reviewing after "do the task"');
		expect(ctx.notices.at(-1)?.message).toContain("after.txt");
	});
});

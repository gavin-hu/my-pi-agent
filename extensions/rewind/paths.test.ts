import { describe, expect, test } from "bun:test";
import { baseName, expandGroup, groupPaths, parseNameStatus, SELECTION_MARKS, summarize } from "./paths.ts";

describe("parseNameStatus", () => {
	test("reads each status letter into its change kind", () => {
		const changed = parseNameStatus(["M\tsrc/a.ts", "D\told.ts", "A\tnew.ts", "T\tbin/tool"].join("\n"));

		expect(changed).toEqual([
			{ path: "src/a.ts", change: "modified" },
			{ path: "old.ts", change: "deleted" },
			{ path: "new.ts", change: "added" },
			{ path: "bin/tool", change: "modified" },
		]);
	});

	test("expands a rename into the deleted and added path", () => {
		const changed = parseNameStatus("R100\tbefore/name.ts\tafter/name.ts");

		expect(changed).toEqual([
			{ path: "before/name.ts", change: "deleted" },
			{ path: "after/name.ts", change: "added" },
		]);
	});

	test("expands a copy into its created path only: the source is untouched", () => {
		expect(parseNameStatus("C75\ta.ts\tb.ts")).toEqual([{ path: "b.ts", change: "added" }]);
	});

	test("ignores blank lines and a status it does not know", () => {
		expect(parseNameStatus("\nU\tconflict.ts\n\nM\tok.ts\n")).toEqual([{ path: "ok.ts", change: "modified" }]);
	});

	test("ignores a truncated rename line instead of inventing a path", () => {
		expect(parseNameStatus("R100\tonly-one.ts")).toEqual([]);
	});
});

describe("groupPaths", () => {
	const changed = parseNameStatus(
		["M\tsrc/b.ts", "A\tsrc/deep/c.ts", "D\troot.ts", "M\tsrc/a.ts", "M\tlib/z.ts"].join("\n"),
	);

	test("puts the root first, then directories in order, with files sorted inside", () => {
		const groups = groupPaths(changed);

		expect(groups.map((group) => group.dir)).toEqual(["", "lib", "src", "src/deep"]);
		expect(groups[2]?.paths.map((entry) => baseName(entry.path))).toEqual(["a.ts", "b.ts"]);
	});

	test("carries the change kind through the grouping", () => {
		const groups = groupPaths(changed);
		const root = groups[0];

		expect(root?.paths).toEqual([{ path: "root.ts", change: "deleted" }]);
	});

	test("an empty diff has no groups", () => {
		expect(groupPaths([])).toEqual([]);
	});
});

describe("expandGroup", () => {
	test("selects every file in the directory", () => {
		const [root] = groupPaths(parseNameStatus(["D\troot.ts", "M\tlib/a.ts"].join("\n")));

		expect(expandGroup(root!)).toEqual(["root.ts"]);
	});
});

describe("summarize", () => {
	test("counts modified and deleted as changed, added as removed", () => {
		const changed = parseNameStatus(["M\ta.ts", "D\tb.ts", "A\tc.ts", "A\td.ts"].join("\n"));

		expect(summarize(changed)).toEqual({ changed: 2, removed: 2 });
	});

	test("an empty diff counts nothing", () => {
		expect(summarize([])).toEqual({ changed: 0, removed: 0 });
	});
});

describe("SELECTION_MARKS", () => {
	test("gives every change kind a one-column mark", () => {
		for (const change of ["modified", "deleted", "added"] as const) {
			expect(SELECTION_MARKS[change]).toHaveLength(1);
		}
	});
});

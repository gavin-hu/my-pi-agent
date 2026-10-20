import { describe, expect, test } from "bun:test";
import {
	baseName,
	expandGroup,
	groupPaths,
	parseNameStatus,
	parseNumStat,
	SELECTION_MARKS,
	summarize,
	toReviewEntries,
} from "./paths.ts";

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

describe("parseNumStat", () => {
	test("reads text counts and binary dashes", () => {
		const stats = parseNumStat("12\t3\tsrc/a.ts\n-\t-\tassets/logo.png\n0\t0\tempty.txt");

		expect(stats.get("src/a.ts")).toEqual({ added: 12, removed: 3 });
		expect(stats.get("assets/logo.png")).toEqual({ added: null, removed: null });
		expect(stats.get("empty.txt")).toEqual({ added: 0, removed: 0 });
	});

	test("keeps a path that contains a tab", () => {
		expect(parseNumStat("1\t2\tdir/weird\tname.txt").get("dir/weird\tname.txt")).toEqual({ added: 1, removed: 2 });
	});

	test("skips blank and malformed lines", () => {
		expect(parseNumStat("\nnot-a-stat\n1\t2\n10\tnot-a-number\tx.txt\n")).toEqual(new Map());
	});
});

describe("toReviewEntries", () => {
	test("sorts by path and attaches counts, defaulting a missing stat to null", () => {
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
});

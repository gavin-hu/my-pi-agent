import { describe, expect, test } from "bun:test";
import { fuzzyMatch, fuzzySearch, type FuzzyResult } from "./fuzzy.ts";

/**
 * Today's ranking, restated independently: rank every path, sort them all, keep
 * the first `limit`. The bounded window in `fuzzySearch` must agree with this
 * exactly — the tie-breaks (length, then the path) are what a shortcut usually
 * gets wrong, so they are spelled out here rather than imported.
 */
function referenceSearch(query: string, paths: readonly string[], limit: number): FuzzyResult[] {
	if (query.trim() === "" || limit <= 0) return [];
	const scored = paths
		.map((path) => ({ path, match: fuzzyMatch(query.trim(), path) }))
		.filter(
			(entry): entry is { path: string; match: NonNullable<ReturnType<typeof fuzzyMatch>> } =>
				entry.match !== undefined,
		)
		.map(({ path, match }) => ({ path, positions: match.positions, score: match.score }));
	scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
	return scored.slice(0, limit).map(({ path, positions }) => ({ path, positions }));
}

/** A fixed-seed generator, so the corpus is the same on every run and platform. */
function corpus(count: number): string[] {
	let seed = 0x5f3759df;
	const next = (): number => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
	const dirs = ["src", "lib", "test", "docs", "core/api", "a", "components/forms"];
	const names = ["readme", "index", "file", "panel", "bridge", "model", "render", "a"];
	const exts = [".ts", ".md", ".json", ""];
	return Array.from({ length: count }, (_, index) => {
		const dir = dirs[Math.floor(next() * dirs.length)];
		const name = names[Math.floor(next() * names.length)];
		const ext = exts[Math.floor(next() * exts.length)];
		return `${dir}/n${index % 13}/${name}${index}${ext}`;
	});
}

describe("fuzzyMatch", () => {
	test("matches a subsequence and returns its positions", () => {
		expect(fuzzyMatch("rme", "README.md")?.positions).toEqual([0, 4, 5]);
	});

	test("is case-insensitive but rewards exact case", () => {
		expect(fuzzyMatch("readme", "README.md")).toBeDefined();
		const exact = fuzzyMatch("R", "README.md");
		const loose = fuzzyMatch("r", "README.md");
		expect(exact && loose && exact.score > loose.score).toBe(true);
	});

	test("returns undefined when the query is not a subsequence", () => {
		expect(fuzzyMatch("zzz", "README.md")).toBeUndefined();
		expect(fuzzyMatch("mer", "README.md")).toBeUndefined();
	});

	test("an empty query matches with no positions", () => {
		expect(fuzzyMatch("", "a.ts")).toEqual({ score: 0, positions: [] });
	});

	test("treats an over-long query as no match", () => {
		expect(fuzzyMatch("a".repeat(300), "a".repeat(300))).toBeUndefined();
	});
});

describe("fuzzySearch", () => {
	test("ranks a basename match above a directory match", () => {
		const results = fuzzySearch("readme", ["readme/something.ts", "src/readme.ts"], 10);
		expect(results[0]?.path).toBe("src/readme.ts");
	});

	test("returns nothing for an empty query", () => {
		expect(fuzzySearch("", ["a.ts"], 10)).toEqual([]);
		expect(fuzzySearch("   ", ["a.ts"], 10)).toEqual([]);
	});

	test("caps results and preserves matched positions", () => {
		const paths = Array.from({ length: 10 }, (_, index) => `file-${index}.ts`);
		const results = fuzzySearch("file", paths, 3);
		expect(results).toHaveLength(3);
		expect(results[0]?.positions).toEqual([0, 1, 2, 3]);
	});

	test("agrees with a full sort on a fixed corpus, at every cap", () => {
		const paths = corpus(500);
		for (const query of ["a", "re", "render", "n1", "forms", "zz", "."]) {
			for (const limit of [1, 2, 7, 50, 600]) {
				expect(fuzzySearch(query, paths, limit)).toEqual(referenceSearch(query, paths, limit));
			}
		}
	});

	test("breaks an equal score by length, then by the path itself", () => {
		// Three paths the same length with the same score: only the final tie-break
		// separates them, and it must not depend on the input order.
		const paths = ["ab/c.ts", "ac/b.ts", "aa/d.ts"];
		const forward = fuzzySearch("a", paths, 3);
		const reversed = fuzzySearch("a", [...paths].reverse(), 3);
		expect(forward).toEqual(referenceSearch("a", paths, 3));
		expect(reversed).toEqual(forward);

		// Same score and same length, differing only in case of the matched column.
		const tied = ["Ab.ts", "ab.ts"];
		expect(fuzzySearch("a", tied, 2)).toEqual(referenceSearch("a", tied, 2));
	});

	test("does not reorder the array it was given", () => {
		const paths = ["c.ts", "a.ts", "b.ts"];
		fuzzySearch("ts", paths, 2);
		expect(paths).toEqual(["c.ts", "a.ts", "b.ts"]);
	});
});

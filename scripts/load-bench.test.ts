/**
 * What the load reading must cover, on any machine.
 *
 * The timings `bun run bench:load` prints depend on the host, so this suite pins
 * only what is wrong everywhere: the table must speak for every entry the `pi`
 * manifest declares — Pi is handed those paths, not the `extensions/` directory —
 * and each must resolve a graph, since a walker that stopped resolving would print
 * a table of zeroes and read as a cheap package.
 */

import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { manifestEntries } from "../test/helpers/graph.ts";
import { reading } from "./load-bench.ts";

const ROOT = join(import.meta.dir, "..");

/**
 * The one walk of the real tree: every case below reads it, so it is derived once
 * rather than five times — a second `reading(ROOT)` would answer the same tree again.
 */
const read = reading(ROOT);

describe("the load reading", () => {
	test("every entry the manifest declares is read, exactly once", () => {
		const declared = manifestEntries(ROOT).length;
		const names = read.rows.map((row) => row.name);
		expect(names.length).toBe(declared);
		expect(new Set(names).size, "two entries in one directory would share a row").toBe(declared);
	});

	test("every entry resolves a graph, and the `lib/` and shared parts are inside it", () => {
		const offenders: string[] = [];
		for (const row of read.rows) {
			if (row.modules === 0) offenders.push(`${row.name}: resolved no modules`);
			if (row.lib > row.modules) offenders.push(`${row.name}: ${row.lib} lib/ modules of ${row.modules}`);
			if (row.shared > row.modules) offenders.push(`${row.name}: ${row.shared} shared modules of ${row.modules}`);
		}
		expect(offenders, "a reading of nothing is a broken walker, not a cheap package").toEqual([]);
	});

	test("the shared list accounts for every repeated evaluation, and names each module once", () => {
		// A module evaluated `k` times contributes `k - 1` to the duplicate count, so the list
		// is the totals broken out rather than a second, hand-kept number beside them.
		const repeated = read.shared.reduce((sum, module) => sum + module.entries - 1, 0);
		expect(repeated).toBe(read.evaluations - read.unique);
		expect(new Set(read.shared.map((module) => module.file)).size).toBe(read.shared.length);
		expect(read.shared.every((module) => module.entries > 1)).toBe(true);
	});

	test("the shared list is most-shared first, and its paths are the docs' posix form", () => {
		const counts = read.shared.map((module) => module.entries);
		expect(counts).toEqual([...counts].sort((a, b) => b - a));
		// The docs quote these paths, so a module is named from the package root on every
		// platform; an absolute or backslashed one would be a sentence that only holds here.
		expect(read.shared.filter((module) => module.file.startsWith("/") || module.file.includes("\\"))).toEqual([]);
	});

	test("the totals are the rows, and the duplication is counted not guessed", () => {
		expect(read.evaluations).toBe(read.rows.reduce((sum, row) => sum + row.modules, 0));
		// Pi loads each extension with its own module cache, so more evaluations than
		// modules is the shared `lib/` graph being paid once per importing entry. A 1:1
		// ratio would mean the walker stopped following edges between entries.
		expect(read.evaluations).toBeGreaterThan(read.unique);
	});
});

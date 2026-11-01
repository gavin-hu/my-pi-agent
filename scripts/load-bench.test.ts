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

describe("the load reading", () => {
	test("every entry the manifest declares is read, exactly once", () => {
		const declared = manifestEntries(ROOT).length;
		const names = reading(ROOT).rows.map((row) => row.name);
		expect(names.length).toBe(declared);
		expect(new Set(names).size, "two entries in one directory would share a row").toBe(declared);
	});

	test("every entry resolves a graph, and the `lib/` and shared parts are inside it", () => {
		const offenders: string[] = [];
		for (const row of reading(ROOT).rows) {
			if (row.modules === 0) offenders.push(`${row.name}: resolved no modules`);
			if (row.lib > row.modules) offenders.push(`${row.name}: ${row.lib} lib/ modules of ${row.modules}`);
			if (row.shared > row.modules) offenders.push(`${row.name}: ${row.shared} shared modules of ${row.modules}`);
		}
		expect(offenders, "a reading of nothing is a broken walker, not a cheap package").toEqual([]);
	});

	test("the totals are the rows, and the duplication is counted not guessed", () => {
		const read = reading(ROOT);
		expect(read.evaluations).toBe(read.rows.reduce((sum, row) => sum + row.modules, 0));
		// Pi loads each extension with its own module cache, so more evaluations than
		// modules is the shared `lib/` graph being paid once per importing entry. A 1:1
		// ratio would mean the walker stopped following edges between entries.
		expect(read.evaluations).toBeGreaterThan(read.unique);
	});
});

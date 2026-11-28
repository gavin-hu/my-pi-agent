/**
 * The shared index as a map, not a second account.
 *
 * `lib/README.md` exists so "a helper nobody can find gets written again" does not
 * happen. A row therefore holds the map — its link and every export name it needs —
 * and the reasoning stays in the module header, or in `lib/workflow/README.md`'s
 * paragraph for that module. What this suite holds to a number is the row's **prose**:
 * code spans and link targets are stripped before counting, which is how a row keeps
 * every name a search would land on.
 *
 * Not the entry catalog's `ROW_WORDS` in `drift.test.ts`. That one counts raw words,
 * the names a row cites included, because an extension's catalog row is one sentence
 * and the names are the sentence; here the names are the map. Two budgets that read
 * alike measure different things.
 *
 * A row is a **selection** of a module's names, not its export list: the map orients a
 * reader, and nothing here checks that every export is named. A gate for that would be
 * a different card, and a different rule — this one protects the row's shape.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { posixPath, walkFiles } from "./helpers/files.ts";
import { relative } from "./helpers/scan.ts";

const repo = posixPath(join(import.meta.dir, ".."));
const libDir = join(repo, "lib");

/** Every non-test TypeScript module under `lib/`; a barrel is a re-export list, not a module. */
function libModules(): string[] {
	return walkFiles(libDir)
		.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
		.filter((file) => !relative(file).endsWith("/index.ts"));
}

/** The index's body rows: one line per module or directory, each opening with its link. */
const rows = readFileSync(join(libDir, "README.md"), "utf-8")
	.split("\n")
	.filter((line) => line.startsWith("|") && line.includes("](./"));

/**
 * A row's prose: what it says once the map is taken out of it.
 *
 * Code spans and link targets are stripped, and a token needs a letter or a digit to
 * be a word — so a list of export names and a table's punctuation cost nothing, and
 * only the sentence around them is measured.
 */
function proseWords(row: string): number {
	return row
		.replace(/`[^`]*`/g, " ")
		.replace(/\]\([^)]*\)/g, " ")
		.replace(/[|\[]/g, " ")
		.split(/\s+/)
		.filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** One row's prose ceiling. */
const LIB_ROW_WORDS = 40;

/** The table's prose total; it only falls, like every budget in the tree. */
const LIB_INDEX_WORDS = 1115;

describe("the shared index", () => {
	test("every lib module has a row in lib/README.md", () => {
		const missing = libModules()
			.filter((file) => {
				const module = relative(file).slice("lib/".length);
				return !rows.some((row) => row.includes(`](./${module})`));
			})
			.map((file) => `${relative(file)}: no table row in lib/README.md; a helper nobody can find gets written again`);
		expect(missing).toEqual([]);
	});

	test("keeps every row's prose to one line", () => {
		const long = rows
			.map((row) => ({ row, count: proseWords(row) }))
			.filter((entry) => entry.count > LIB_ROW_WORDS)
			.map((entry) => `${entry.count} words: ${entry.row.slice(0, 60)}`);
		expect(long, "move the reasoning into the module header; the row keeps the names").toEqual([]);
	});

	test("holds the index's prose total to its budget", () => {
		const total = rows.reduce((sum, row) => sum + proseWords(row), 0);
		expect(total, "lower LIB_INDEX_WORDS with the table; a row's names are not prose").toBeLessThanOrEqual(
			LIB_INDEX_WORDS,
		);
	});

	test("counts a row's sentence and not the names beside it", () => {
		// The edge the ceiling turns on, in both directions: a long link list with a short
		// sentence passes, and one word past the ceiling is counted as one word past it.
		const names = Array.from({ length: 12 }, (_, index) => `\`name${index}\``).join(", ");
		expect(proseWords(`| [\`x.ts\`](./x.ts) | The one line about it, naming ${names}. |`)).toBe(6);
		const over = `| [\`x.ts\`](./x.ts) | ${"word ".repeat(LIB_ROW_WORDS + 1)}|`;
		expect(proseWords(over)).toBe(LIB_ROW_WORDS + 1);
	});
});

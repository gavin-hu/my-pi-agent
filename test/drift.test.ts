/**
 * Drift guard for the two things the shared-helper gate cannot see.
 *
 * `test/shared-helpers.test.ts` answers "is this helper written twice". These two
 * answer the slower failures around it:
 *
 * - a shared module nobody can find, because the `lib/README.md` index and the
 *   modules on disk drifted apart, so the next session writes a fourth copy;
 * - `AGENTS.md` growing back into a second manual, which is how the rules stop
 *   being read at all.
 *
 * Both are ratchets: the index is compared against the tree, and the word budget
 * only ever falls. A duplicate body is not repeated here; that gate owns it.
 */

import { readFileSync } from "node:fs";
import { join, posix as posixPath } from "node:path";
import { describe, expect, test } from "bun:test";
import { walkFiles } from "./helpers/files.ts";

const repo = posixPath.join(import.meta.dir, "..").replaceAll("\\", "/");
const libDir = join(repo, "lib");

/** A path relative to the repo, in posix form, so a failure names the same file on every OS. */
const relative = (file: string): string => file.slice(repo.length + 1).replaceAll("\\", "/");

/** Every non-test TypeScript module under `lib/`. */
function libModules(): string[] {
	return (
		walkFiles(libDir)
			.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
			// A barrel is a re-export list, not a module of its own.
			.filter((file) => !relative(file).endsWith("/index.ts"))
	);
}

describe("the shared surface index", () => {
	test("every lib module has a row in lib/README.md", () => {
		const rows = readFileSync(join(libDir, "README.md"), "utf-8")
			.split("\n")
			.filter((line) => line.startsWith("|"));
		const missing = libModules()
			.filter((file) => {
				const module = relative(file).slice("lib/".length);
				return !rows.some((row) => row.includes(`](./${module})`));
			})
			.map((file) => `${relative(file)}: no table row in lib/README.md; a helper nobody can find gets written again`);
		expect(missing).toEqual([]);
	});
});

describe("the agent contract", () => {
	/**
	 * `AGENTS.md` is the entry point: the rules and their gates, with the reasoning
	 * in the guides it links. This is the ceiling that keeps a new paragraph from
	 * turning it back into a manual — lower it when the file shrinks.
	 */
	const CEILING = 1450;

	test("AGENTS.md stays inside its word budget", () => {
		const words = readFileSync(join(repo, "AGENTS.md"), "utf-8").split(/\s+/).filter(Boolean).length;
		expect(words, "move the reasoning into a guide and link it").toBeLessThanOrEqual(CEILING);
	});
});

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
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { walkFiles } from "./helpers/files.ts";

// `join` resolves the `..` on every platform, including Windows, where the
// backslashed absolute path is one long name to `posix.join`.
const repo = join(import.meta.dir, "..").replaceAll("\\", "/");
const libDir = join(repo, "lib");

/**
 * A path relative to `root`, in posix form, so a failure names the same file on
 * every OS. Slicing a native Windows path and normalising it is the whole
 * platform story, so it is a named function the test below can hold to it.
 */
function relativeTo(root: string, file: string): string {
	return file.slice(root.length + 1).replaceAll("\\", "/");
}

const relative = (file: string): string => relativeTo(repo, file);

/** Every non-test TypeScript module under `lib/`. */
function libModules(): string[] {
	return (
		walkFiles(libDir)
			.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
			// A barrel is a re-export list, not a module of its own.
			.filter((file) => !relative(file).endsWith("/index.ts"))
	);
}

test("the repo root it measures from is resolved and posix", () => {
	// A `..` left in place shifts every slice by one segment, which passes on macOS
	// and Linux and fails on Windows; the backslash check is the same trap.
	expect(repo).not.toContain("..");
	expect(repo).not.toContain("\\");
});

test("a native Windows path slices to the same posix module name", () => {
	expect(relativeTo("D:/a/my-pi-agent", "D:\\a\\my-pi-agent\\lib\\format.ts")).toBe("lib/format.ts");
	expect(relativeTo("/Users/gavin/my-pi-agent", "/Users/gavin/my-pi-agent/lib/format.ts")).toBe("lib/format.ts");
});

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
	const CEILING = 1326;

	test("AGENTS.md stays inside its word budget", () => {
		const words = readFileSync(join(repo, "AGENTS.md"), "utf-8").split(/\s+/).filter(Boolean).length;
		expect(words, "move the reasoning into a guide and link it").toBeLessThanOrEqual(CEILING);
	});
});

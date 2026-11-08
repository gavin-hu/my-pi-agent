/**
 * Drift guard for the two things the shared-helper gate cannot see.
 *
 * `test/shared-helpers.test.ts` answers "is this helper written twice". These three
 * answer the slower failures around it:
 *
 * - a shared module nobody can find, because the `lib/README.md` index and the
 *   modules on disk drifted apart, so the next session writes a fourth copy;
 * - `AGENTS.md` growing back into a second manual, which is how the rules stop
 *   being read at all;
 * - the entry README's catalog growing back into a manual too, one long table cell
 *   at a time, which is how a reader stops scanning it and the page starts
 *   restating the extension pages beside it.
 *
 * All three are ratchets: the index is compared against the tree, and the two word
 * budgets only ever fall. A duplicate body is not repeated here; that gate owns it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { walkFiles } from "./helpers/files.ts";
import { relative } from "./helpers/scan.ts";

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

/**
 * The body rows of every table between `## What you get` and the next `## `, and
 * how many words each one holds. A separator row is punctuation, not a row.
 */
function catalogRows(markdown: string): string[] {
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => line.trim() === "## What you get");
	if (start < 0) return [];
	const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
	return lines
		.slice(start, end < 0 ? undefined : end)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("|") && !/^[\s|:-]+$/.test(line));
}

/** The words in one Markdown line, by the same split every budget here uses. */
function words(line: string): number {
	return line.split(/\s+/).filter(Boolean).length;
}

describe("the entry README catalog", () => {
	/**
	 * The catalog is what a reader scans to pick an extension: a name, its commands,
	 * and one line about what it buys. `board`'s row reached 207 words once, holding
	 * a copy of `docs/extensions/board.md` in a table cell — this is the ratchet that
	 * keeps that copy from coming back. Both ceilings may only fall; lower each one
	 * when the page shrinks.
	 *
	 * Only the English README is measured. CJK words are not whitespace separated, so
	 * a word count over the mirror would be a number about nothing; the mirror's row
	 * count is held by `docs-parity.test.ts` and its length by review.
	 */
	const CATALOG_WORDS = 566;
	const ROW_WORDS = 35;

	const rows = catalogRows(readFileSync(join(repo, "README.md"), "utf-8"));

	test("measures the catalog, so a section renamed out from under it fails here", () => {
		expect(rows.length, "no table rows under `## What you get`").toBeGreaterThan(0);
	});

	test("keeps the catalog inside its word budget", () => {
		const total = rows.reduce((sum, row) => sum + words(row), 0);
		expect(total, "move the detail onto the extension's page and link it").toBeLessThanOrEqual(CATALOG_WORDS);
	});

	test("keeps every catalog row to one line", () => {
		const longest = rows.reduce((widest, row) => (words(row) > words(widest) ? row : widest), "");
		expect(words(longest), `the longest row: ${longest.slice(0, 60)}`).toBeLessThanOrEqual(ROW_WORDS);
	});
});

describe("the agent contract", () => {
	/**
	 * `AGENTS.md` is the entry point: the rules and their gates, with the reasoning
	 * in the guides it links. This is the ceiling that keeps a new paragraph from
	 * turning it back into a manual — lower it when the file shrinks.
	 */
	const CEILING = 1288;

	test("AGENTS.md stays inside its word budget", () => {
		const words = readFileSync(join(repo, "AGENTS.md"), "utf-8").split(/\s+/).filter(Boolean).length;
		expect(words, "move the reasoning into a guide and link it").toBeLessThanOrEqual(CEILING);
	});
});

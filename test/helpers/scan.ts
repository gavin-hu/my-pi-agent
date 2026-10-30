/**
 * The scanned tree: the repository paths a guard reads, and one read per file.
 *
 * Every gate in `test/*.test.ts` asks the same three questions — where a file is, what it
 * says, and how long it is — so the paths, the memo, and the line count live here rather than
 * in each gate. A guard that walked its own roots and re-read a file per assertion was how the
 * one structure file grew seven jobs.
 *
 * The memo is a cache of immutable text, not shared state: `bun test` gives each test file its
 * own worker, and nothing here is written after the first read.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { posix, walkFiles } from "./files.ts";

/** The repository root, posix-normalized so a sliced path compares on every host. */
export const repo = posix(join(import.meta.dir, "..", ".."));

/** `test/`, which holds the package-level contracts and the shared helpers. */
export const testDir = posix(join(repo, "test"));
export const extensionsDir = posix(join(repo, "extensions"));
export const libDir = posix(join(repo, "lib"));
export const scriptsDir = posix(join(repo, "scripts"));

/**
 * Every directory whose capability suites the banned-pattern scan covers.
 * `extensions/` is enumerated so a new extension is covered automatically;
 * `lib/` is included explicitly.
 */
export const SCANNED_DIRS: string[] = [...dirsOf(extensionsDir).map((name) => join(extensionsDir, name)), libDir];

/** The dirs whose plain source the banned-pattern scan covers: `scripts/` is dev tooling, and shipped nowhere. */
export const SOURCE_DIRS: string[] = [...SCANNED_DIRS, scriptsDir];

/** A path relative to the repository root, in posix form so a failure names one file on every OS. */
export function relative(file: string): string {
	return file.slice(repo.length + 1).replaceAll("\\", "/");
}

/** A file's text, read once per test run; tests write only under OS temp dirs. */
const textCache = new Map<string, string>();
export function textOf(file: string): string {
	const cached = textCache.get(file);
	if (cached !== undefined) return cached;
	const text = readFileSync(file, "utf-8");
	textCache.set(file, text);
	return text;
}

/** A tree walk, run once per root; `existsSync`/`statSync` stay uncached. */
const walkCache = new Map<string, string[]>();
export function filesIn(root: string): string[] {
	const cached = walkCache.get(root);
	if (cached !== undefined) return cached;
	const files = walkFiles(root);
	walkCache.set(root, files);
	return files;
}

/** The directories directly under `dir`, sorted. */
export function dirsOf(dir: string): string[] {
	return readdirSync(dir)
		.filter((name) => statSync(join(dir, name)).isDirectory())
		.sort();
}

/** Extension/lib source files (not `.test.ts`). */
export function sourceFiles(root: string): string[] {
	return filesIn(root).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
}

/** Lines in a module, counted the way `wc -l` does (a trailing newline does not count). */
export function lineCount(file: string): number {
	return textOf(file).replace(/\n$/, "").split("\n").length;
}

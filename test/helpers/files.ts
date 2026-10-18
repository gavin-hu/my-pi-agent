/**
 * Filesystem walking for the package-level guards.
 *
 * Shared so the structure guard and the docs guard enumerate the tree the same
 * way: posix-normalized absolute paths, sorted, so a failure message and a set
 * comparison do not depend on `readdir` order.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Normalise separators so path comparisons work on Windows too. */
const posix = (path: string): string => path.replaceAll("\\", "/");

/** Every file under `dir`, recursively, posix-normalized and sorted. */
export function walkFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir).sort()) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walkFiles(full, out);
		else out.push(posix(full));
	}
	return out;
}

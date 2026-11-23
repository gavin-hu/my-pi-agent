/**
 * Filesystem walking for the package-level guards.
 *
 * Shared so the structure guard and the docs guard enumerate the tree the same
 * way: posix-spelled absolute paths, sorted, so a failure message and a set
 * comparison do not depend on `readdir` order. The spelling itself is
 * `lib/path.ts`'s `posixPath`, re-exported here so a caller that walks a tree and
 * compares what it found imports both from one place.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { posixPath } from "../../lib/path.ts";

export { posixPath };

/** Every file under `dir`, recursively, posix-spelled and sorted. */
export function walkFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir).sort()) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walkFiles(full, out);
		else out.push(posixPath(full));
	}
	return out;
}

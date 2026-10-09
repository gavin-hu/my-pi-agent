/**
 * Path containment shared by the extensions that resolve untrusted paths.
 *
 * The file-browser serves files under a root, the worktree guards keep tool
 * calls inside the active worktree, and the doc extension reads documents under
 * the effective root; all must answer the same question — is a resolved target
 * the root itself or beneath it? Keeping the predicates here means the guards
 * cannot drift apart.
 *
 * `isInside` compares path strings; `isInsideReal` first resolves symlinks in
 * the deepest existing ancestor, so a link that leaves the root is refused.
 *
 * No runtime dependencies beyond `node:fs` and `node:path`.
 */

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Whether `target` is `root` itself or sits underneath it. */
export function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Real path of `path`, resolving symlinks in the deepest existing ancestor even
 * when the leaf does not exist yet.
 */
export function realPathOfNearest(path: string): string {
	const absolute = resolve(path);
	const missing: string[] = [];
	let current = absolute;
	while (!existsSync(current)) {
		const parent = dirname(current);
		if (parent === current) return absolute;
		missing.unshift(basename(current));
		current = parent;
	}
	try {
		return join(realpathSync.native(current), ...missing);
	} catch {
		return absolute;
	}
}

/** Whether `target` stays inside `root` once symlinks are resolved. */
export function isInsideReal(root: string, target: string): boolean {
	return isInside(realPathOfNearest(root), realPathOfNearest(target));
}

/**
 * Path containment shared by the extensions that resolve untrusted paths.
 *
 * The file-browse extension serves files under a root, the worktree guards keep tool
 * calls inside the active worktree, and the doc extension reads documents under
 * the effective root; all must answer the same question — is a resolved target
 * the root itself or beneath it? Keeping the predicates here means the guards
 * cannot drift apart.
 *
 * `isInside` compares path strings; `isInsideReal` first resolves symlinks in
 * the deepest existing ancestor, so a link that leaves the root is refused.
 * `lastSegment` names the part a path ends in — the directory a session is read as,
 * the last folder of a root-relative page — splitting on either separator, because
 * git prints forward slashes on Windows.
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

/**
 * The segment a path ends in, with trailing separators and a root ignored.
 *
 * Either separator splits, so a path git printed on Windows and a path built by this
 * platform give the same answer; a path that has no segment — `/`, or the empty string
 * — yields the empty string rather than its own punctuation.
 */
export function lastSegment(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

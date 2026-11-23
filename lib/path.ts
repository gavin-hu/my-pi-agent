/**
 * Path containment shared by the extensions that resolve untrusted paths.
 *
 * The file-browse extension serves files under a root, the worktree guards keep tool
 * calls inside the active worktree, and the doc extension canonicalizes the path
 * it hands a parser; all must answer the same question — is a resolved target
 * the root itself or beneath it? Keeping the predicates here means the guards
 * cannot drift apart.
 *
 * `isInside` compares path strings; `isInsideReal` first resolves symlinks in
 * the deepest existing ancestor, so a link that leaves the root is refused.
 * `lastSegment` names the part a path ends in — the directory a session is read as,
 * the last folder of a root-relative page.
 *
 * One spelling rule, stated here because four functions read it: `posixPath` is the
 * POSIX spelling this package prints, compares and encodes in, and its separators come
 * from `node:path` rather than from a typed character — `win32.sep` as well as
 * `posix.sep`, because git prints forward slashes on Windows and a page served here may
 * name a root another platform built.
 *
 * No runtime dependencies beyond `node:fs` and `node:path`.
 */

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";

/** The separators a path may arrive with, taken from `node:path` rather than typed. */
const SEPARATORS = [win32.sep, posix.sep] as const;

/** `value` in the POSIX spelling this package prints, compares and encodes in. */
export function posixPath(value: string): string {
	return SEPARATORS.reduce((out, separator) => out.split(separator).join(posix.sep), value);
}

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
 * `posixPath` normalises first, so a path git printed on Windows and a path built by
 * this platform give the same answer; a path that has no segment — `/`, or the empty
 * string — yields the empty string rather than its own punctuation.
 */
export function lastSegment(path: string): string {
	return posixPath(path).split(posix.sep).filter(Boolean).at(-1) ?? "";
}

/**
 * Percent-encode each segment of a root-relative path, keeping its separators.
 *
 * A URL is built from a path git printed, and a path may hold a space, a `#` or a `?`:
 * encoding per segment keeps the separators readable while the segments are safe.
 */
export function encodePath(rel: string): string {
	return posixPath(rel)
		.split(posix.sep)
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join(posix.sep);
}

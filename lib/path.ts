/**
 * Path containment shared by the extensions that resolve untrusted paths.
 *
 * The file-browser serves files under a root and the worktree guards keep tool
 * calls inside the active worktree; both must answer the same question — is a
 * resolved target the root itself or beneath it? Keeping the predicate here
 * means the two guards cannot drift apart.
 *
 * No runtime dependencies beyond `node:path`.
 */

import { isAbsolute, relative, sep } from "node:path";

/** Whether `target` is `root` itself or sits underneath it. */
export function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

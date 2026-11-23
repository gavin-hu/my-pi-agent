/**
 * Where a plan lives, and which paths may be read or written as one.
 *
 * A plan file is the artifact a card is executed against, so two extensions have to
 * agree about it: `plan` writes and reads the store, and `board` records the file a
 * card promises. The store is `<agent-dir>/repos/<id>/plans`, the sibling of the board
 * that proves a plan — one repository's state is one directory (#771) — and every caller
 * derives it from a store it already resolved rather than from a key of its own.
 *
 * `plansDir`/`plansDirFor` are the spelling that store replaced: `<agent-dir>/plans/<key>`,
 * or `<agent-dir>/plans` outside a repository. They survive as the mover's legacy argument
 * (`lib/store-paths.ts`) and as the tree a recorded path may still name for one release,
 * which is what {@link legacyPlanStore} answers.
 *
 * The rules are one body for the same reason: a copy of `isContainedPlan` that
 * dropped the symlink half would look identical at a glance and would be the one
 * that let a link inside the store point outside it. `plan` passes a path here
 * before it writes; `board` passes the path it is about to record, and asks whether
 * it is a plan of this repository.
 *
 * Value-only: no module state, and the only I/O is the `lstat` a symlink check needs.
 */

import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { isInside, isInsideReal } from "../path.ts";

/** The agent-directory entry plans are filed under. */
export const PLANS_DIR_NAME = "plans";

/**
 * The directory a repository's stores are filed under: `<agent-dir>/repos/<id>/<concept>`.
 *
 * `repo-key.ts`'s `reposRoot` spells this too, and that module is the owner of the name — it is
 * repeated here because importing it would put the whole git cluster into the registration graph
 * of every entry that reads a plan (`ENTRY_BUDGET`), and this module's need is one `basename`.
 */
const REPOS_DIR_NAME = "repos";

/** The legacy plan store: `<agent-dir>/plans`, or `<agent-dir>/plans/<key>` inside a repository. */
export function plansDir(agentDir: string, key?: string): string {
	return key === undefined ? join(agentDir, PLANS_DIR_NAME) : join(agentDir, PLANS_DIR_NAME, key);
}

/**
 * The legacy store for a resolved repository: keyed when git answered, unkeyed outside one.
 *
 * The `fromGit` branch lives here and nowhere else — that is the line a copy gets wrong, and
 * both the plan tool and the board reach it through this one function. It names where a store
 * *was*, so the two callers today pass it as `lib/store-paths.ts`'s legacy argument.
 */
export function plansDirFor(agentDir: string, repo: { key: string; fromGit?: boolean }): string {
	return plansDir(agentDir, repo.fromGit ? repo.key : undefined);
}

/**
 * The flat plans tree this store replaced, or nothing when the store is not filed under `repos/`.
 *
 * A record written before #771 names a path in the flat tree, and the mover has since taken the
 * store across — so a recorded path is looked for where it points and, for one release, in here.
 * Derived from the store the caller already holds, because a second `repoKeyFor` call would be
 * the drift this function exists to end.
 */
export function legacyPlanStore(planDir: string): string | undefined {
	// `<agent-dir>/repos/<id>/plans`: the store is two levels under the directory that holds `repos`.
	const repos = dirname(dirname(planDir));
	return basename(repos) === REPOS_DIR_NAME ? join(dirname(repos), PLANS_DIR_NAME) : undefined;
}

/** A plan file name: markdown and not a dotfile, so the self-ignore file is never a target. */
export function isPlanFileName(path: string): boolean {
	const name = basename(path);
	return name.toLowerCase().endsWith(".md") && !name.startsWith(".");
}

/**
 * Whether `path` may be read, written, or deleted as a plan. Beyond lexical
 * containment (shared with the other path guards through `lib/path.ts`), this
 * rejects dotfiles (including the directory's own `.gitignore`) and resolves
 * symlinks, so a link placed inside the plans directory cannot redirect a read
 * or write outside it.
 */
export function isContainedPlan(dir: string, path: string): boolean {
	if (!isInside(dir, path) || !isPlanFileName(path)) return false;
	try {
		// A symlink itself must never be the target; a missing file is a new plan.
		if (lstatSync(path).isSymbolicLink()) return false;
	} catch {
		// Missing (ENOENT) is expected; any other error falls through to the
		// real-path check, which rejects the path if it cannot be resolved.
	}
	return isInsideReal(dir, dirname(path));
}

/**
 * Resolve a `plan_path` argument against the store.
 *
 * A plan lives outside the project, so a path relative to the working directory
 * can no longer name one. Absolute paths and the `~/…` form the tools display are
 * accepted, and a bare name resolves inside the store — which is what a reader of
 * a tool result has in hand.
 */
export function resolvePlanArg(dir: string, planPath: string): string {
	const text = planPath.trim();
	if (text === "~") return homedir();
	if (text.startsWith("~/") || text.startsWith(`~${sep}`)) return resolve(homedir(), text.slice(2));
	return isAbsolute(text) ? resolve(text) : resolve(dir, text);
}

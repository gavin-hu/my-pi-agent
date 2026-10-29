/**
 * Where a plan lives, and which paths may be read or written as one.
 *
 * A plan file is the artifact a card is executed against, so two extensions have to
 * agree about it: `plan` writes and reads the store, and `board` records the file a
 * card promises. The store is `<agent-dir>/plans/<repo-key>` for a repository and
 * `<agent-dir>/plans` outside one — the key is the same one `repo-key.ts` hands
 * every other per-repository store, which is why the keyed branch lives here rather
 * than in either caller.
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
import type { RepoKey } from "../repo-key.ts";

/** The agent-directory entry plans are filed under. */
export const PLANS_DIR_NAME = "plans";

/** The plan store: `<agent-dir>/plans`, or `<agent-dir>/plans/<key>` inside a repository. */
export function plansDir(agentDir: string, key?: string): string {
	return key === undefined ? join(agentDir, PLANS_DIR_NAME) : join(agentDir, PLANS_DIR_NAME, key);
}

/**
 * The store for a resolved repository: keyed when git answered, unkeyed outside one.
 *
 * The `fromGit` branch lives here and nowhere else — that is the line a copy gets wrong,
 * and both the plan tool and the board reach it through this one function.
 */
export function plansDirFor(agentDir: string, repo: Pick<RepoKey, "key" | "fromGit">): string {
	return plansDir(agentDir, repo.fromGit ? repo.key : undefined);
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

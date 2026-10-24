/**
 * The per-repository storage key that outlives one checkout.
 *
 * Two extensions file state by repository — `session-bus` its sessions, mail, and
 * claims, `plan` its plans — and both must resolve the same key from any
 * worktree, so a plan approved in `.pi/worktrees/x` is the same plan from the
 * main checkout. The key is the repository's *common* git directory, which every
 * worktree of that repository shares; outside a repository the working directory
 * is the identity.
 *
 * Hashing keeps a mail directory, a claims directory, and a plans directory short
 * enough to read and safe on every filesystem, while staying unique per
 * repository.
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExecRunner, gitCommonDir, repoRoot } from "./git/index.ts";

/** Hex characters kept from the digest: collision-free in practice and short enough for a path. */
export const REPO_KEY_LENGTH = 12;

/** The key for one identity string, hashed and shortened. */
export function repoKeyOf(value: string): string {
	return createHash("sha256").update(canonical(value)).digest("hex").slice(0, REPO_KEY_LENGTH);
}

/**
 * One path, one spelling.
 *
 * git prints the path it was told to work from, so a repository reached through a
 * symlinked prefix reports a different common dir for the same repository. Two
 * spellings would file one repository's plans and claims under two keys, so the
 * real path is what gets hashed; a path that cannot be resolved keeps its own
 * spelling rather than failing.
 */
function canonical(value: string): string {
	try {
		return realpathSync.native(value);
	} catch {
		return value;
	}
}

/** A resolved repository identity. */
export interface RepoKey {
	/** Absolute repository root, or `cwd` when git did not answer. */
	root: string;
	/** The shared key, derived from the common git directory. */
	key: string;
	/**
	 * Whether git resolved the repository. A caller that needs a *project-local*
	 * location branches on this; one that only needs a stable directory does not.
	 */
	fromGit: boolean;
}

/**
 * Resolve the repository identity for `cwd`.
 *
 * Never throws: without git, or when a git call fails, the working directory is
 * the identity — which is what a caller outside a repository wants anyway.
 */
export async function repoKeyFor(pi: Pick<ExtensionAPI, "exec">, cwd: string): Promise<RepoKey> {
	try {
		const run = createExecRunner(pi);
		const [common, root] = await Promise.all([gitCommonDir(run, cwd), repoRoot(run, cwd)]);
		if (root) return { root, key: repoKeyOf(common ?? root), fromGit: true };
	} catch {
		// Fall through: no git, or a git call that failed, is the same answer here.
	}
	return { root: cwd, key: repoKeyOf(cwd), fromGit: false };
}

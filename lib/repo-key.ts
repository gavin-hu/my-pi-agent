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
import { basename, dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "./env.ts";
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
	/**
	 * Where the repository keeps its project settings: the checkout's root, which is the
	 * parent of the common git directory.
	 *
	 * A worktree's {@link RepoKey.root} is the worktree, and `.pi/` is gitignored there, so the
	 * settings a repository states live in the checkout both trees share. Outside git, or when
	 * the common directory is not a `.git` (a bare repository, a submodule's store), this is
	 * {@link RepoKey.root} — the nearest answer that exists.
	 */
	settingsRoot: string;
}

/**
 * The repository's settings root for a working directory: the checkout a config read or write
 * targets.
 *
 * The cwd a command receives is the session's, which in a worktree is the worktree — where `.pi/`
 * is gitignored. Settings are the repository's, so a command that reads one and then writes it,
 * and a surface that only reads it, all resolve the same root the board's store does.
 */
export async function settingsRootFor(pi: Pick<ExtensionAPI, "exec">, cwd: string): Promise<string> {
	return (await repoKeyFor(pi, resolveEffectiveCwd(cwd))).settingsRoot;
}

/**
 * The checkout a common git directory belongs to, or `root` when it names no `.git`.
 *
 * One question, because the two answers are different trees: a linked worktree's common dir is
 * the main checkout's `.git`, whose parent is the checkout. A bare repository's common dir, or a
 * submodule's store, is not a `.git` — there the working root is the only place settings can be.
 */
function settingsRootOf(common: string | undefined, root: string): string {
	return common !== undefined && basename(common) === ".git" ? dirname(common) : root;
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
		if (root)
			return { root, key: repoKeyOf(common ?? root), settingsRoot: settingsRootOf(common, root), fromGit: true };
	} catch {
		// Fall through: no git, or a git call that failed, is the same answer here.
	}
	return { root: cwd, key: repoKeyOf(cwd), settingsRoot: cwd, fromGit: false };
}

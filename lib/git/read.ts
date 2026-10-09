/**
 * Read-only git queries.
 *
 * Small helpers that ask git *about* the repository rather than changing it.
 * They run through an injected {@link RunGit}, so they are testable without a
 * runtime. Keeping them here means worktree, rewind, and plan share one
 * definition instead of re-implementing `rev-parse`.
 */

import { realpathSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExecRunner, type RunGit } from "./runner.ts";

/** Absolute repository root containing `cwd`, or undefined when not a git repo. */
export async function repoRoot(runGit: RunGit, cwd: string): Promise<string | undefined> {
	const result = await runGit(["rev-parse", "--show-toplevel"], { cwd });
	if (result.code !== 0) return undefined;
	const root = result.stdout.trim();
	if (!root) return undefined;
	// git prints forward slashes on Windows even for `--show-toplevel`, so resolve
	// to the native real path: it then compares equal to fs paths and to a
	// snapshot root recorded elsewhere. Fall back to git's string when the path
	// is not resolvable (for example a fake runner in a unit test).
	try {
		return realpathSync.native(root);
	} catch {
		return root;
	}
}

/**
 * Repository root via a Pi `exec`, optionally capping each git call with
 * `timeoutMs`. Never throws: a failed or stuck git call yields `undefined`.
 */
export async function repoRootFor(
	pi: Pick<ExtensionAPI, "exec">,
	cwd: string,
	timeoutMs?: number,
): Promise<string | undefined> {
	const run = createExecRunner(pi);
	const runGit: RunGit = timeoutMs === undefined ? run : (args, options) => run(args, { timeoutMs, ...options });
	try {
		return await repoRoot(runGit, cwd);
	} catch {
		return undefined;
	}
}

/** Absolute path of the repository's git directory. */
export async function gitDir(runGit: RunGit, cwd: string): Promise<string | undefined> {
	const result = await runGit(["rev-parse", "--absolute-git-dir"], { cwd });
	if (result.code !== 0) return undefined;
	const dir = result.stdout.trim();
	return dir || undefined;
}

/** Resolve a revision to a full object id, or undefined when it does not exist. */
export async function revParse(runGit: RunGit, cwd: string, rev: string): Promise<string | undefined> {
	const result = await runGit(["rev-parse", "--verify", "--quiet", rev], { cwd });
	if (result.code !== 0) return undefined;
	const id = result.stdout.trim();
	return id || undefined;
}

/** Whether the repository has at least one commit. */
export async function hasCommits(runGit: RunGit, cwd: string): Promise<boolean> {
	return (await revParse(runGit, cwd, "HEAD")) !== undefined;
}

/** Branch checked out at `cwd`, or undefined when HEAD is detached. */
export async function currentBranch(runGit: RunGit, cwd: string): Promise<string | undefined> {
	const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
	if (result.code !== 0) return undefined;
	const branch = result.stdout.trim();
	return branch && branch !== "HEAD" ? branch : undefined;
}

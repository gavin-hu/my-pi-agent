/**
 * Shared low-level git plumbing.
 *
 * Extensions that shell out to git differ in *what* they ask git to do, but all
 * of them need the same seam: a runner that returns `{ stdout, stderr, code }`,
 * an optional timeout, and extra environment (for a temporary index). Keeping
 * the runner and the small read helpers here means worktree, rewind, and
 * plan-mode share one definition instead of re-implementing `rev-parse`.
 *
 * `RunGit` is the seam tests replace with a fake; `createExecRunner` backs it
 * with `pi.exec` in production.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface GitResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

export interface RunGitOptions {
	cwd: string;
	timeoutMs?: number;
	/** Extra environment for this call (used for `GIT_INDEX_FILE`). */
	env?: Record<string, string>;
}

export type RunGit = (args: string[], options: RunGitOptions) => Promise<GitResult>;

/** A failed git call with a model-readable message. */
export class GitError extends Error {
	constructor(
		message: string,
		readonly code: number,
	) {
		super(message);
		this.name = "GitError";
	}
}

/** Run git through `pi.exec`, mapping `timeoutMs` to Pi's `timeout` option. */
export function createExecRunner(pi: Pick<ExtensionAPI, "exec">): RunGit {
	return async (args, options) => {
		const result = await pi.exec("git", args, {
			cwd: options.cwd,
			...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
		});
		return { stdout: result.stdout, stderr: result.stderr, code: result.code, killed: result.killed };
	};
}

/** Run git and throw {@link GitError} on a non-zero exit. */
export async function runGitOrThrow(runGit: RunGit, args: string[], options: RunGitOptions): Promise<string> {
	const result = await runGit(args, options);
	if (result.code !== 0) {
		const detail = (result.stderr || result.stdout).trim() || `git ${args[0]} exited with code ${result.code}`;
		throw new GitError(detail, result.code);
	}
	return result.stdout;
}

/** Absolute repository root containing `cwd`, or undefined when not a git repo. */
export async function repoRoot(runGit: RunGit, cwd: string): Promise<string | undefined> {
	const result = await runGit(["rev-parse", "--show-toplevel"], { cwd });
	if (result.code !== 0) return undefined;
	const root = result.stdout.trim();
	return root || undefined;
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

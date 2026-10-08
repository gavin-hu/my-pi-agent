/**
 * Git plumbing for the rewind extension.
 *
 * Everything runs through an injected {@link RunGit}, so the algorithms are
 * testable with a fake runner and use `pi.exec` in production. Snapshots are
 * built through a temporary index (`GIT_INDEX_FILE`) so the user's real index
 * and HEAD are never modified.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

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

/** Run git and throw {@link GitError} on a non-zero exit. */
async function run(runGit: RunGit, args: string[], options: RunGitOptions): Promise<string> {
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

/** Stage the working tree into a temporary index and return its tree id. */
export async function treeFromWorkingTree(
	runGit: RunGit,
	cwd: string,
	indexFile: string,
	includeUntracked: boolean,
): Promise<string> {
	const env = { GIT_INDEX_FILE: indexFile };
	await run(runGit, ["add", includeUntracked ? "-A" : "-u"], { cwd, env });
	return (await run(runGit, ["write-tree"], { cwd, env })).trim();
}

/** Read a tree id from the current index without staging anything. */
export async function treeFromIndex(runGit: RunGit, cwd: string, indexFile: string): Promise<string | undefined> {
	const result = await runGit(["write-tree"], { cwd, env: { GIT_INDEX_FILE: indexFile } });
	if (result.code !== 0) return undefined;
	const tree = result.stdout.trim();
	return tree || undefined;
}

/**
 * Create a commit object for `tree` with `parent`, using a fixed pi identity so
 * the call succeeds even in a repo without `user.name`/`user.email` configured.
 */
export async function commitTree(
	runGit: RunGit,
	cwd: string,
	tree: string,
	parent: string,
	message: string,
): Promise<string> {
	const out = await run(
		runGit,
		["-c", "user.name=pi", "-c", "user.email=pi@localhost", "commit-tree", tree, "-p", parent, "-m", message],
		{ cwd },
	);
	return out.trim();
}

/** Point a ref at a commit. */
export async function updateRef(runGit: RunGit, cwd: string, ref: string, commit: string): Promise<void> {
	await run(runGit, ["update-ref", ref, commit], { cwd });
}

/** Delete a ref if it exists. */
export async function deleteRef(runGit: RunGit, cwd: string, ref: string): Promise<void> {
	await run(runGit, ["update-ref", "-d", ref], { cwd });
}

/** `refname` -> commit for every ref under `namespace`. */
export async function listRefs(runGit: RunGit, cwd: string, namespace: string): Promise<Map<string, string>> {
	const result = await runGit(["for-each-ref", "--format=%(objectname) %(refname)", namespace], { cwd });
	const refs = new Map<string, string>();
	if (result.code !== 0) return refs;
	for (const line of result.stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const space = trimmed.indexOf(" ");
		if (space <= 0) continue;
		refs.set(trimmed.slice(space + 1), trimmed.slice(0, space));
	}
	return refs;
}

/** Full commit messages for a list of commits, keyed by commit id. */
export async function commitMessages(
	runGit: RunGit,
	cwd: string,
	commits: string[],
): Promise<Map<string, string>> {
	const messages = new Map<string, string>();
	if (commits.length === 0) return messages;
	const result = await runGit(["log", "--no-color", "--no-walk", "--format=%H%x00%B%x1e", ...commits], { cwd });
	if (result.code !== 0) return messages;
	for (const record of result.stdout.split("\x1e")) {
		const trimmed = record.replace(/^\n+/, "");
		if (!trimmed) continue;
		const nul = trimmed.indexOf("\x00");
		if (nul <= 0) continue;
		messages.set(trimmed.slice(0, nul), trimmed.slice(nul + 1));
	}
	return messages;
}

/** Reset the index and working tree to a commit's tree, without moving HEAD. */
export async function readTreeReset(runGit: RunGit, cwd: string, commit: string, indexFile: string): Promise<void> {
	await run(runGit, ["read-tree", "--reset", "-u", commit], { cwd, env: { GIT_INDEX_FILE: indexFile } });
}

/** Paths added between two trees (present in `to`, absent from `from`). */
export async function addedPaths(runGit: RunGit, cwd: string, from: string, to: string): Promise<string[]> {
	const result = await runGit(["diff", "--no-color", "--name-only", "--diff-filter=A", from, to], { cwd });
	if (result.code !== 0) return [];
	return result.stdout.split("\n").filter((line) => line.trim().length > 0);
}

/** `git diff --stat` between two trees. */
export async function diffStat(runGit: RunGit, cwd: string, from: string, to: string): Promise<string> {
	const result = await runGit(["diff", "--no-color", "--stat", from, to, "--"], { cwd });
	return result.code === 0 ? result.stdout.trim() : "";
}

/** Count of paths changed between two trees, optionally filtered by diff status. */
export async function changedCount(
	runGit: RunGit,
	cwd: string,
	from: string,
	to: string,
	filter?: string,
): Promise<number> {
	const args = ["diff", "--no-color", "--name-only"];
	if (filter) args.push(`--diff-filter=${filter}`);
	args.push(from, to, "--");
	const result = await runGit(args, { cwd });
	if (result.code !== 0) return 0;
	return result.stdout.split("\n").filter((line) => line.trim().length > 0).length;
}

/** Label of an in-progress git operation that a rewind must not clobber, if any. */
export async function busyGitState(runGit: RunGit, cwd: string): Promise<string | undefined> {
	const markers: Array<[string, string]> = [
		["MERGE_HEAD", "merge"],
		["rebase-merge", "rebase"],
		["rebase-apply", "rebase"],
		["CHERRY_PICK_HEAD", "cherry-pick"],
		["REVERT_HEAD", "revert"],
		["BISECT_LOG", "bisect"],
	];
	for (const [name, label] of markers) {
		const result = await runGit(["rev-parse", "--git-path", name], { cwd });
		if (result.code !== 0) continue;
		const path = result.stdout.trim();
		if (path && existsSync(resolve(cwd, path))) return label;
	}
	return undefined;
}

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
import {
	GitError,
	currentBranch,
	gitDir,
	hasCommits,
	repoRoot,
	revParse,
	runGitOrThrow as run,
	type GitResult,
	type RunGit,
	type RunGitOptions,
} from "../_shared/git.ts";

export {
	GitError,
	currentBranch,
	gitDir,
	hasCommits,
	repoRoot,
	revParse,
	type GitResult,
	type RunGit,
	type RunGitOptions,
};

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
export async function commitMessages(runGit: RunGit, cwd: string, commits: string[]): Promise<Map<string, string>> {
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

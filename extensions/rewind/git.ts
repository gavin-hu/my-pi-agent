/**
 * Git plumbing for the rewind extension.
 *
 * The single git entry point for the extension: it defines the rewind-specific
 * plumbing, re-exports the shared read helpers the extension consumes, and
 * builds the production runner. Everything runs through an injected
 * {@link RunGit}, so the algorithms are testable with a fake runner and use
 * `pi.exec` in production. Snapshots are built through a temporary index
 * (`GIT_INDEX_FILE`) so the user's real index and HEAD are never modified.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createExecRunner,
	GitError,
	currentBranch,
	gitDir,
	repoRoot,
	revParse,
	revParseMany,
	runGitOrThrow as run,
	type RunGit,
} from "../../lib/git/index.ts";
import { parseNameStatus, parseNumStat, type ChangedPath, type PathStat } from "./paths.ts";

// Re-export exactly the shared helpers this extension consumes, so rewind code
// has one git import surface instead of reaching into `lib/git` directly.
export { GitError, currentBranch, gitDir, repoRoot, revParse, revParseMany, type RunGit };

/** Timeout budget for one git command issued by this extension. */
const SNAPSHOT_TIMEOUT_MS = 30_000;

/**
 * Production runner: the shared exec seam applies per-call `env`; rewind caps
 * every git command with its own timeout.
 */
export function createRewindRunner(pi: ExtensionAPI): RunGit {
	const exec = createExecRunner(pi);
	return (args, options) => exec(args, { timeoutMs: SNAPSHOT_TIMEOUT_MS, ...options });
}

/**
 * Stage the working tree into a temporary index and return its tree id.
 *
 * With `includeUntracked`, `add -A` stages everything in one call from an empty
 * index. Without it the temp index must be seeded from HEAD first: `add -u`
 * only updates paths already in the index, so on a fresh, empty index it stages
 * nothing and `write-tree` would return the empty tree.
 */
export async function treeFromWorkingTree(
	runGit: RunGit,
	cwd: string,
	indexFile: string,
	includeUntracked: boolean,
): Promise<string> {
	const env = { GIT_INDEX_FILE: indexFile };
	if (includeUntracked) {
		await run(runGit, ["add", "-A"], { cwd, env });
	} else {
		await run(runGit, ["read-tree", "HEAD"], { cwd, env });
		await run(runGit, ["add", "-u"], { cwd, env });
	}
	return (await run(runGit, ["write-tree"], { cwd, env })).trim();
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

/**
 * A pathspec that matches `path` literally.
 *
 * The paths come from `git diff` output, so a file named `weird[1].txt` is a real
 * possibility; without `:(literal)` git would read it as a glob and restore the
 * wrong thing (or nothing).
 */
function literalPathspec(path: string): string {
	return `:(literal)${path}`;
}

/**
 * The changed paths between two trees, with how each changed.
 *
 * One call replaces the separate added-path and changed-count queries, so the
 * preview, the checklist, and the apply step all read the same list. Rename
 * detection is explicit (`-M`) rather than inherited from `diff.renames`, so a
 * user's git config cannot change what a selection covers.
 */
export async function nameStatus(
	runGit: RunGit,
	cwd: string,
	from: string,
	to: string,
	paths?: readonly string[],
): Promise<ChangedPath[]> {
	const args = ["diff", "--no-color", "-M", "--name-status", from, to, "--"];
	if (paths) args.push(...paths.map(literalPathspec));
	const result = await runGit(args, { cwd });
	return result.code === 0 ? parseNameStatus(result.stdout) : [];
}

/**
 * `git diff --stat` between two trees, optionally limited to `paths`.
 *
 * Rename detection matches `nameStatus`, so the confirm preview names the move
 * even though the per-file patch below stays a delete plus a create.
 */
export async function diffStat(
	runGit: RunGit,
	cwd: string,
	from: string,
	to: string,
	paths?: readonly string[],
): Promise<string> {
	const args = ["diff", "--no-color", "-M", "--stat", from, to, "--"];
	if (paths) args.push(...paths.map(literalPathspec));
	const result = await runGit(args, { cwd });
	return result.code === 0 ? result.stdout.trim() : "";
}

/**
 * A unified patch between two trees, optionally limited to `paths`.
 *
 * `--no-renames` is deliberate: `nameStatus` pairs a rename into one row, while
 * its patch stays a delete plus a create, which describes exactly the two working
 * tree operations a revert of that row performs.
 */
export async function diffPatch(
	runGit: RunGit,
	cwd: string,
	from: string,
	to: string,
	paths?: readonly string[],
): Promise<string> {
	const args = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=3", from, to, "--"];
	if (paths) args.push(...paths.map(literalPathspec));
	const result = await runGit(args, { cwd });
	return result.code === 0 ? result.stdout : "";
}

/**
 * Per-path added/removed line counts between two trees, with binary as nulls.
 *
 * `--no-renames` keeps a rename's removed lines on its source and its added lines
 * on its destination; `toReviewEntries` joins the two onto the paired entry.
 */
export async function diffNumStat(
	runGit: RunGit,
	cwd: string,
	from: string,
	to: string,
	paths?: readonly string[],
): Promise<Map<string, PathStat>> {
	const args = ["diff", "--no-color", "--numstat", "--no-renames", from, to, "--"];
	if (paths) args.push(...paths.map(literalPathspec));
	const result = await runGit(args, { cwd });
	return result.code === 0 ? parseNumStat(result.stdout) : new Map();
}

/**
 * Rewrite the given paths in the working tree from `commit`.
 *
 * `read-tree --reset -u` takes no pathspec, so a partial restore checks the paths
 * out of the snapshot instead. The index it writes is the temporary one, so the
 * real index stays untouched exactly as the whole-tree reset leaves it. Callers
 * pass only paths present in `commit`; an added path is deleted, not checked out.
 */
export async function restorePaths(
	runGit: RunGit,
	cwd: string,
	commit: string,
	indexFile: string,
	paths: readonly string[],
): Promise<void> {
	if (paths.length === 0) return;
	await run(runGit, ["checkout", commit, "--", ...paths.map(literalPathspec)], {
		cwd,
		env: { GIT_INDEX_FILE: indexFile },
	});
}

/**
 * Reverse-apply a prepared patch to the working tree.
 *
 * `pi.exec` has no stdin, so the patch goes through a private temporary
 * directory and a path argument. Without `--index` or `--cached`, `git apply`
 * writes only the working tree, and it verifies every hunk before writing, so a
 * file edited after its diff was read fails atomically instead of applying stale
 * context. The caller builds the patch from already-fetched diff output.
 */
export async function applyPatchReverse(runGit: RunGit, cwd: string, patch: string): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "pi-rewind-patch-"));
	try {
		const file = join(dir, "patch.diff");
		writeFileSync(file, patch);
		await run(runGit, ["apply", "--reverse", "--whitespace=nowarn", file], { cwd });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * The markers an interrupted git operation leaves, in precedence order: the
 * first one present names the operation a rewind would clobber.
 */
const BUSY_MARKERS: ReadonlyArray<readonly [string, string]> = [
	["MERGE_HEAD", "merge"],
	["rebase-merge", "rebase"],
	["rebase-apply", "rebase"],
	["CHERRY_PICK_HEAD", "cherry-pick"],
	["REVERT_HEAD", "revert"],
	["BISECT_LOG", "bisect"],
];

/**
 * Label of an in-progress git operation that a rewind must not clobber, if any.
 *
 * `rev-parse --git-path` prints one path per argument, so all six markers are one
 * git call: a clean repository — the common case, where every one of them is
 * missing — would otherwise pay six spawns to learn nothing is in progress.
 */
export async function busyGitState(runGit: RunGit, cwd: string): Promise<string | undefined> {
	const result = await runGit(["rev-parse", ...BUSY_MARKERS.flatMap(([name]) => ["--git-path", name])], { cwd });
	if (result.code !== 0) return undefined;
	const paths = result.stdout.split("\n");
	for (const [index, [, label]] of BUSY_MARKERS.entries()) {
		const path = paths[index]?.trim();
		if (path && existsSync(resolve(cwd, path))) return label;
	}
	return undefined;
}

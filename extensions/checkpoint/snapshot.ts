/**
 * Snapshot creation.
 *
 * A snapshot is a commit whose tree is the working tree (tracked files plus,
 * by default, untracked non-ignored files). A clean working tree still records
 * a commit so the metadata line is attached; git deduplicates the tree object,
 * so the overhead is one small commit. The real index and HEAD are never
 * touched: all staging happens in a temporary index.
 */

import { commitTree, currentBranch, revParse, treeFromWorkingTree, updateRef, GitError, type RunGit } from "./git.ts";
import { encodeMessage, refFor, type CheckpointMeta } from "./store.ts";
import type { Checkpoint, CheckpointReason } from "./types.ts";

export interface SnapshotDeps {
	runGit: RunGit;
	/** Clock, injectable for deterministic tests. */
	now?: () => number;
	/** Id factory, injectable for deterministic tests. */
	idFactory?: (now: number) => string;
}

export interface SnapshotInput {
	/** Repository (or worktree) root the snapshot covers. */
	root: string;
	/** Temporary index path used for staging. */
	indexFile: string;
	/** Ref namespace to write under. */
	namespace: string;
	reason: CheckpointReason;
	label?: string;
	tool?: string;
	turn?: number;
	includeUntracked: boolean;
}

/** Default id: base-36 timestamp plus a short random suffix. */
export function defaultId(now: number): string {
	return `c-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Point a ref at the current working tree and return the recorded checkpoint. */
export async function createCheckpoint(deps: SnapshotDeps, input: SnapshotInput): Promise<Checkpoint> {
	const { runGit } = deps;
	const head = await revParse(runGit, input.root, "HEAD");
	if (!head) throw new GitError("the repository has no commits to snapshot.", 1);

	const tree = await treeFromWorkingTree(runGit, input.root, input.indexFile, input.includeUntracked);
	const headTree = await revParse(runGit, input.root, "HEAD^{tree}");
	const clean = tree === headTree;

	const now = deps.now?.() ?? Date.now();
	const id = deps.idFactory?.(now) ?? defaultId(now);
	const branch = await currentBranch(runGit, input.root);

	const meta: CheckpointMeta = {
		id,
		tree,
		reason: input.reason,
		label: input.label,
		tool: input.tool,
		turn: input.turn,
		timestamp: now,
		root: input.root,
		branch,
		head,
		clean,
		includeUntracked: input.includeUntracked,
	};

	// Always commit so the metadata travels with the snapshot; `commit-tree`
	// reuses the identical tree object, so a clean snapshot costs only a commit.
	const ref = refFor(input.namespace, id);
	const commit = await commitTree(runGit, input.root, tree, head, encodeMessage(meta));
	await updateRef(runGit, input.root, ref, commit);

	return { ...meta, ref, commit };
}

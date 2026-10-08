/**
 * Rewind: restore the working tree and index to a snapshot without moving HEAD.
 *
 * `read-tree --reset -u` brings tracked files back to the snapshot (restoring
 * modifications and deletions and removing paths the snapshot never had). Files
 * created after the snapshot and never tracked are then deleted explicitly,
 * because `read-tree` leaves untracked files alone. HEAD, branches, and reflogs
 * are untouched.
 */

import { lstatSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
	addedPaths,
	busyGitState,
	changedCount,
	diffStat,
	readTreeReset,
	treeFromWorkingTree,
	type RunGit,
} from "./git.ts";
import type { Snapshot, RestoreSummary } from "./types.ts";

export interface RestoreDeps {
	runGit: RunGit;
}

export interface RestoreInput {
	/** Repository (or worktree) root to restore into. */
	root: string;
	/** Temporary index path used for staging. */
	indexFile: string;
	/** Snapshot to restore. */
	target: Snapshot;
}

export interface RestorePlan {
	/** `git diff --stat` preview between the snapshot and the working tree. */
	diff: string;
	/** Tracked files modified or deleted since the snapshot. */
	changed: number;
	/** Paths created since the snapshot that the restore removes. */
	removed: number;
}

export type PlanResult = { ok: true; plan: RestorePlan } | { ok: false; reason: string };

/** Explain why a restore cannot proceed, or produce a preview. */
export async function planRestore(deps: RestoreDeps, input: RestoreInput): Promise<PlanResult> {
	const busy = await busyGitState(deps.runGit, input.root);
	if (busy) {
		return { ok: false, reason: `a git ${busy} is in progress; finish or abort it before restoring.` };
	}
	// Compare tree-to-tree, so untracked files captured in the snapshot are not
	// mistaken for deletions against the real index.
	const cur = await treeFromWorkingTree(
		deps.runGit,
		input.root,
		input.indexFile,
		input.target.includeUntracked,
	);
	const added = await addedPaths(deps.runGit, input.root, input.target.commit, cur);
	const changed = await changedCount(deps.runGit, input.root, input.target.commit, cur, "MD");
	const diff = await diffStat(deps.runGit, input.root, input.target.commit, cur);
	return { ok: true, plan: { diff, changed, removed: added.length } };
}

/** Delete a path under `root`, refusing to escape it or remove a directory. */
function deleteFile(root: string, relative: string): void {
	const absolute = resolve(root, relative);
	if (absolute !== root && !absolute.startsWith(root + sep)) return;
	try {
		if (lstatSync(absolute).isDirectory()) return;
		rmSync(absolute, { force: true });
	} catch {
		// Missing or already removed; nothing to do.
	}
}

/** Apply the restore. Recomputes the removal set immediately before mutating. */
export async function applyRestore(deps: RestoreDeps, input: RestoreInput): Promise<RestoreSummary> {
	const cur = await treeFromWorkingTree(
		deps.runGit,
		input.root,
		input.indexFile,
		input.target.includeUntracked,
	);
	const added = await addedPaths(deps.runGit, input.root, input.target.commit, cur);
	const changed = await changedCount(deps.runGit, input.root, input.target.commit, cur, "MD");

	await readTreeReset(deps.runGit, input.root, input.target.commit, input.indexFile);
	for (const path of added) deleteFile(input.root, path);

	return { id: input.target.id, commit: input.target.commit, root: input.root, changed, removed: added.length };
}

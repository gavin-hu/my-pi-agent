/**
 * Rewind: restore the working tree and index to a snapshot without moving HEAD.
 *
 * The whole-tree restore runs `read-tree --reset -u` against the snapshot, which
 * brings tracked files back (restoring modifications and deletions and removing
 * paths the snapshot never had). Files created after the snapshot and never
 * tracked are then deleted explicitly, because `read-tree` leaves untracked files
 * alone. HEAD, branches, and reflogs are untouched.
 *
 * A **partial** restore takes the same shape over a subset: `read-tree` accepts no
 * pathspec, so the selected paths are checked out of the snapshot instead, and
 * only the selected additions are deleted. Everything else is left exactly as it
 * is, and the same temporary index is used, so the real index stays untouched
 * either way.
 */

import { lstatSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
	busyGitState,
	diffStat,
	nameStatus,
	readTreeReset,
	restorePaths,
	treeFromWorkingTree,
	type RunGit,
} from "./git.ts";
import { summarize, type ChangedPath } from "./paths.ts";
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
	/** Restore only these paths; omitted means the whole tree. */
	paths?: readonly string[];
}

export interface RestorePlan {
	/** `git diff --stat` preview between the snapshot and the working tree. */
	diff: string;
	/** Tracked files modified or deleted since the snapshot. */
	changed: number;
	/** Paths created since the snapshot that the restore removes. */
	removed: number;
	/** Every changed path, with how the restore treats it. */
	paths: ChangedPath[];
	/** Tree id of the staged working tree the comparison used. */
	currentTree: string;
}

export type PlanResult = { ok: true; plan: RestorePlan } | { ok: false; reason: string };

/** Explain why a restore cannot proceed, or produce a preview. */
export async function planRestore(deps: RestoreDeps, input: RestoreInput): Promise<PlanResult> {
	const busy = await busyGitState(deps.runGit, input.root);
	if (busy) {
		return { ok: false, reason: `a git ${busy} is in progress; finish or abort it before restoring.` };
	}
	const cur = await stagedTree(deps, input);
	const paths = await changedPaths(deps, input, cur);
	const diff = await diffStat(deps.runGit, input.root, input.target.commit, cur, selectionOf(paths));
	return { ok: true, plan: { diff, ...summarize(paths), paths, currentTree: cur } };
}

/** The selection narrowed to paths the plan actually found, or undefined for all. */
function selectionOf(paths: readonly ChangedPath[]): string[] | undefined {
	return paths.length > 0 ? paths.map((entry) => entry.path) : undefined;
}

/**
 * Stage the working tree into the temporary index, so previews compare
 * tree-to-tree: untracked files captured in the snapshot are not mistaken for
 * deletions against the real index.
 */
async function stagedTree(deps: RestoreDeps, input: RestoreInput): Promise<string> {
	return treeFromWorkingTree(deps.runGit, input.root, input.indexFile, input.target.includeUntracked);
}

/** Every changed path, narrowed to the caller's selection when one is given. */
async function changedPaths(deps: RestoreDeps, input: RestoreInput, cur: string): Promise<ChangedPath[]> {
	const all = await nameStatus(deps.runGit, input.root, input.target.commit, cur);
	if (!input.paths) return all;
	const selected = new Set(input.paths);
	return all.filter((entry) => selected.has(entry.path));
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

/**
 * Apply the restore. Recomputes the changed set immediately before mutating, so a
 * file edited while the confirmation was open is still handled correctly.
 */
export async function applyRestore(deps: RestoreDeps, input: RestoreInput): Promise<RestoreSummary> {
	const cur = await stagedTree(deps, input);
	const paths = await changedPaths(deps, input, cur);
	const { changed, removed } = summarize(paths);
	const rewritten = paths.filter((entry) => entry.change !== "added").map((entry) => entry.path);
	const created = paths.filter((entry) => entry.change === "added").map((entry) => entry.path);

	if (input.paths) {
		await restorePaths(deps.runGit, input.root, input.target.commit, input.indexFile, rewritten);
	} else {
		// The whole tree in one call: this also removes files the snapshot lacks,
		// which a pathspec checkout of every changed path would not.
		await readTreeReset(deps.runGit, input.root, input.target.commit, input.indexFile);
	}
	for (const path of created) deleteFile(input.root, path);

	// A subset notice says "2 of 5 files", so it needs the whole diff's size; the
	// all-path query is already in hand when nothing was narrowed.
	const of = input.paths ? (await nameStatus(deps.runGit, input.root, input.target.commit, cur)).length : paths.length;

	return {
		id: input.target.id,
		commit: input.target.commit,
		root: input.root,
		changed,
		removed,
		...(input.paths ? { of } : {}),
	};
}

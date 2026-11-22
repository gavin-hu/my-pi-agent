/**
 * Worktree pruning: remove clean, unused managed worktrees past the configured
 * age, unlocking entries held by dead processes. Age follows the registry's
 * `lastUsedAt` (falling back to directory mtime for unregistered worktrees).
 */

import { statSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createExecRunner, defaultBranch } from "../../lib/git/index.ts";
import { loadConfig } from "./config.ts";
import {
	deleteBranch,
	inspectWork,
	isStaleLock,
	listManagedWorktrees,
	mergeBase,
	repoRoot,
	unlockWorktree,
	worktreeRemove,
} from "./git.ts";
import { reconcileRegistry, removeRecord, type WorktreeRecord, registryFileFor } from "./registry.ts";
import { getActive } from "./runtime.ts";

/**
 * Age in days from the most recent evidence of use: the registry's
 * `lastUsedAt`, or the directory mtime when there is no record.
 */
function ageInDays(path: string, lastUsedAt = 0): number {
	let newest = lastUsedAt;
	try {
		newest = Math.max(newest, statSync(path).mtimeMs);
	} catch {
		return 0;
	}
	return newest === 0 ? 0 : (Date.now() - newest) / 86_400_000;
}

/**
 * One prune, as both surfaces need it: the sentence the model reads, and the rows a block
 * draws.
 *
 * The two are the same read: a renderer may not shell out, so the paths have to leave here
 * with the report rather than be parsed back out of it.
 */
export interface PruneResult {
	/** The report: one `Removed …` / `Kept …` line each, or `Nothing to prune.`. */
	output: string;
	/** The worktrees this run removed. */
	removed: string[];
	/** The ones it left, each with the reason git gave. */
	kept: string[];
}

/** Remove clean, unused managed worktrees past the prune age. Returns the report and its rows. */
export async function pruneWorktreesResult(pi: ExtensionAPI, ctx: ExtensionContext): Promise<PruneResult> {
	const root = await repoRoot(pi, ctx.cwd);
	if (!root) return { output: "Not a git repository.", removed: [], kept: [] };
	const config = loadConfig(root);
	const managed = await listManagedWorktrees(pi, root, config);
	const registryFile = await registryFileFor(pi, root);
	const { registry } = reconcileRegistry(registryFile, root, managed);
	const byPath = new Map<string, WorktreeRecord>(registry.worktrees.map((record) => [record.path, record]));
	const branch = await defaultBranch(createExecRunner(pi), root);
	const current = getActive();
	const removed: string[] = [];
	const kept: string[] = [];

	for (const entry of managed) {
		if (current?.path === entry.path) {
			kept.push(`${entry.path} (current)`);
			continue;
		}
		if (entry.locked !== undefined) {
			if (isStaleLock(entry.locked)) {
				await unlockWorktree(pi, root, entry.path);
			} else {
				kept.push(`${entry.path} (locked)`);
				continue;
			}
		}
		if (!branch) {
			kept.push(`${entry.path} (no default branch)`);
			continue;
		}
		const fork = await mergeBase(pi, entry.path, `origin/${branch}`);
		if (!fork) {
			kept.push(`${entry.path} (cannot verify)`);
			continue;
		}
		// Count the branch the removal would delete, not just the checkout: a detached
		// HEAD or a second branch here would otherwise make the worktree look unused.
		const { hasWork, unverifiable } = await inspectWork(pi, entry.path, fork, entry.branch);
		if (hasWork || unverifiable) {
			kept.push(`${entry.path} (has work)`);
			continue;
		}
		if (ageInDays(entry.path, byPath.get(entry.path)?.lastUsedAt) < config.pruneAfterDays) {
			kept.push(`${entry.path} (recent)`);
			continue;
		}
		const result = await worktreeRemove(pi, root, entry.path, false);
		if (!result.ok) {
			kept.push(`${entry.path} (${result.error})`);
			continue;
		}
		removed.push(entry.path);
		removeRecord(registryFile, entry.path);
		if (entry.branch) {
			const deleted = await deleteBranch(pi, root, entry.branch, false);
			if (!deleted.ok) kept.push(`branch ${entry.branch} (unmerged, kept)`);
		}
	}

	const output =
		[...removed.map((path) => `Removed ${path}`), ...kept.map((path) => `Kept ${path}`)].join("\n") ||
		"Nothing to prune.";
	return { output, removed, kept };
}

/** The same prune as the sentence the command and the list screen print. */
export async function pruneWorktrees(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
	return (await pruneWorktreesResult(pi, ctx)).output;
}

/**
 * Worktree pruning: remove clean, unused managed worktrees past the configured
 * age, unlocking entries held by dead processes. Age follows the registry's
 * `lastUsedAt` (falling back to directory mtime for unregistered worktrees).
 */

import { statSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import {
	defaultBranch,
	deleteBranch,
	inspectWork,
	isStaleLock,
	listManagedWorktrees,
	mergeBase,
	repoRoot,
	unlockWorktree,
	worktreeRemove,
} from "./git.ts";
import { reconcileRegistry, removeRecord, type WorktreeRecord } from "./registry.ts";
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

/** Remove clean, unused managed worktrees past the prune age. Returns a report. */
export async function pruneWorktrees(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
	const root = await repoRoot(pi, ctx.cwd);
	if (!root) return "Not a git repository.";
	const config = loadConfig(root);
	const managed = await listManagedWorktrees(pi, root, config);
	const { registry } = reconcileRegistry(root, config, managed);
	const byPath = new Map<string, WorktreeRecord>(registry.worktrees.map((record) => [record.path, record]));
	const branch = await defaultBranch(pi, root);
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
		const { hasWork, unverifiable } = await inspectWork(pi, entry.path, fork);
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
		removeRecord(root, config, entry.path);
		if (entry.branch) {
			const deleted = await deleteBranch(pi, root, entry.branch, false);
			if (!deleted.ok) kept.push(`branch ${entry.branch} (unmerged, kept)`);
		}
	}

	return (
		[...removed.map((path) => `Removed ${path}`), ...kept.map((path) => `Kept ${path}`)].join("\n") ||
		"Nothing to prune."
	);
}

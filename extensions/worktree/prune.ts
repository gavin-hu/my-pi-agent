/**
 * Worktree pruning: remove clean, unused managed worktrees past the configured
 * age, unlocking entries held by dead processes.
 */

import { statSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import {
	defaultBranch,
	deleteBranch,
	inspectWork,
	isProcessAlive,
	listManagedWorktrees,
	mergeBase,
	repoRoot,
	unlockWorktree,
	worktreeRemove,
} from "./git.ts";
import { getActive } from "./runtime.ts";

/** Extract the owning pid from a `pi:<pid>:<session>` lock reason. */
function parseLockPid(reason: string): number | undefined {
	const match = reason.match(/^pi:(\d+):/);
	return match ? Number.parseInt(match[1], 10) : undefined;
}

function ageInDays(path: string): number {
	try {
		return (Date.now() - statSync(path).mtimeMs) / 86_400_000;
	} catch {
		return 0;
	}
}

/** Remove clean, unused managed worktrees past the prune age. Returns a report. */
export async function pruneWorktrees(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
	const root = await repoRoot(pi, ctx.cwd);
	if (!root) return "Not a git repository.";
	const config = loadConfig(root);
	const managed = await listManagedWorktrees(pi, root, config);
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
			const pid = parseLockPid(entry.locked);
			if (pid !== undefined && !isProcessAlive(pid)) {
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
		if (ageInDays(entry.path) < config.pruneAfterDays) {
			kept.push(`${entry.path} (recent)`);
			continue;
		}
		const result = await worktreeRemove(pi, root, entry.path, false);
		if (!result.ok) {
			kept.push(`${entry.path} (${result.error})`);
			continue;
		}
		removed.push(entry.path);
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

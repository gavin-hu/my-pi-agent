/**
 * Worktree exit: release the binding, optionally remove the worktree, and
 * decide whether its branch can be deleted.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import {
	deleteBranch,
	inspectWork,
	lockWorktree,
	unlockWorktree,
	worktreeRemove,
} from "./git.ts";
import {
	applyWorktreeEnv,
	clearConfigCache,
	getActive,
	publishWorktree,
	setActive,
	setStatus,
} from "./runtime.ts";
import { persistState, type WorktreeState } from "./state.ts";
import { worktreeLabel } from "./status.ts";

export interface ExitOptions {
	remove?: boolean;
	keepBranch?: boolean;
}

export async function exitWorktree(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: ExitOptions,
): Promise<{ state: WorktreeState; removed: boolean; output: string }> {
	const state = getActive();
	if (!state) throw new Error("Not currently in a worktree.");
	if (state.borrowed) {
		throw new Error("This worktree was inherited from the parent session, which owns it. Ask the parent to call worktree_exit.");
	}
	clearConfigCache();
	const config = loadConfig(state.repoRoot);

	const { dirty, ahead, sub, unverifiable, hasWork } = await inspectWork(pi, state.path, state.baseCommit);
	const workSummary =
		`${dirty.length} changed file(s)` +
		(ahead > 0 ? `, ${ahead} new commit(s)` : "") +
		(sub.count > 0 ? `, ${sub.count} changed submodule file(s)` : "") +
		(unverifiable ? ", submodules could not be inspected" : "");

	let remove: boolean;
	let keepBranch = options.keepBranch ?? false;

	if (options.remove === true) {
		remove = true;
	} else if (options.remove === false) {
		remove = false;
	} else if (config.onExit === "remove") {
		remove = true;
	} else if (config.onExit === "keep") {
		remove = false;
	} else if (!hasWork && !unverifiable) {
		// Claude Code parity: a clean worktree is removed automatically.
		remove = true;
	} else if (ctx.hasUI) {
		const choice = await ctx.ui.select(
			`Worktree "${worktreeLabel(state)}" has work that removal would delete: ${workSummary}.`,
			["Keep it for later", "Remove it and its branch", "Cancel"],
		);
		if (choice === undefined || choice.startsWith("Cancel")) throw new Error("Worktree exit cancelled.");
		remove = choice.startsWith("Remove");
	} else {
		remove = false;
	}

	if (state.lockReason) await unlockWorktree(pi, state.repoRoot, state.path);

	setActive(null);
	persistState((customType, data) => pi.appendEntry(customType, data), { ...state, active: false });
	applyWorktreeEnv(null);
	publishWorktree(pi, null);
	setStatus(ctx, undefined);

	const lines: string[] = [];
	const forceRemove = hasWork || unverifiable;
	// Never delete a branch that still holds work: uncommitted changes that
	// removal discards, or commits not reachable from the recorded base.
	if (remove && dirty.length > 0) keepBranch = true;
	const branchHasWork = ahead > 0 || !state.baseCommit;

	if (remove) {
		const removed = await worktreeRemove(pi, state.repoRoot, state.path, forceRemove);
		if (!removed.ok) {
			lines.push(`Kept the worktree: ${removed.error}`);
			// Re-lock so a concurrent prune cannot sweep a worktree we kept.
			if (state.lockReason) await lockWorktree(pi, state.repoRoot, state.path, state.lockReason);
		} else {
			lines.push(`Removed worktree ${state.path}`);
			if (state.branch) {
				if (keepBranch) {
					lines.push(`Kept branch ${state.branch}`);
				} else if (branchHasWork) {
					lines.push(
						`Kept branch ${state.branch} (${ahead > 0 ? `${ahead} commit(s) not merged` : "unverified commits"}; delete it yourself if unwanted)`,
					);
				} else {
					const deleted = await deleteBranch(pi, state.repoRoot, state.branch, true);
					lines.push(
						deleted.ok ? `Deleted branch ${state.branch}` : `Kept branch ${state.branch}: ${deleted.error}`,
					);
				}
			}
		}
	} else {
		lines.push(`Kept worktree ${state.path}`);
		if (state.branch) lines.push(`Re-enter with worktree_enter (path: ${state.path})`);
	}

	ctx.ui.notify(`Exited worktree ${worktreeLabel(state)}`, "info");
	return { state, removed: remove, output: lines.join("\n") };
}

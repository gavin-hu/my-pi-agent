/**
 * Worktree exit: release the binding, optionally remove the worktree, and
 * decide whether its branch can be deleted.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { WorktreeCancelledError } from "./errors.ts";
import {
	commitsAheadOf,
	currentBranch,
	defaultBranch,
	deleteBranch,
	inspectWork,
	isBranchMerged,
	lockWorktree,
	refExists,
	unlockWorktree,
	worktreePath,
	worktreeRemove,
} from "./git.ts";
import { handoffLines, type Handoff } from "./handoff.ts";
import { removeRecord, touchRecord } from "./registry.ts";
import { applyWorktreeEnv, clearConfigCache, getActive, publishWorktree, setActive, setStatus } from "./runtime.ts";
import { persistState, type WorktreeState } from "./state.ts";
import { worktreeLabel } from "./status.ts";

export interface ExitOptions {
	remove?: boolean;
	keepBranch?: boolean;
}

/**
 * What the branch holds and how to finish it, computed after the outcome is known.
 * A failed lookup degrades to the facts already in hand: an exit that succeeded
 * must not fail because the default branch could not be read.
 */
async function describeHandoff(pi: ExtensionAPI, state: WorktreeState, recorded: number): Promise<Handoff> {
	// `recorded` is the count `inspectWork` took against the commit the worktree was created
	// at, read while the directory was still there; without that commit there is no fork
	// point, and the count is unknown rather than zero.
	const commits = state.baseCommit ? recorded : undefined;
	if (!state.branch) return { branch: null, base: null, ahead: recorded, commits, merged: false };
	try {
		// `origin/HEAD` names the merge target when the repository has a remote; a
		// local-only repository has none, and the main checkout's own branch is the
		// branch a merge would actually land on.
		const base = (await defaultBranch(pi, state.repoRoot)) ?? (await currentBranch(pi, state.repoRoot)) ?? null;
		if (!base) return { branch: state.branch, base: null, ahead: recorded, commits, merged: false };
		// Count against the resolved base branch, not the commit recorded at entry:
		// a worktree branch rebased onto a newer local branch would otherwise report
		// every commit the base gained since, as its own.
		// Every lookup runs in the main checkout: the handoff is read after the exit,
		// when the worktree directory may already be gone, while the branch refs it
		// describes outlive it.
		const root = state.repoRoot;
		const ref = (await refExists(pi, root, base))
			? base
			: (await refExists(pi, root, `origin/${base}`))
				? `origin/${base}`
				: null;
		if (!ref) return { branch: state.branch, base: null, ahead: recorded, commits, merged: false };
		const ahead = await commitsAheadOf(pi, root, state.branch, ref);
		return {
			branch: state.branch,
			base,
			ahead,
			commits,
			merged: ahead === 0 && commits !== 0 && (await isBranchMerged(pi, root, state.branch, ref)),
		};
	} catch {
		return { branch: state.branch, base: null, ahead: recorded, commits, merged: false };
	}
}

export async function exitWorktree(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: ExitOptions,
): Promise<{ state: WorktreeState; removed: boolean; handoff: Handoff; output: string }> {
	const state = getActive();
	if (!state) throw new Error("Not currently in a worktree.");
	if (state.borrowed) {
		throw new Error(
			"This worktree was inherited from the parent session, which owns it. Ask the parent to call `worktree` action `exit`.",
		);
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
	} else if (!hasWork && !unverifiable && state.createdByUs) {
		// Claude Code parity: a clean worktree we created is removed
		// automatically. A worktree the user pointed us at is never removed
		// without confirmation.
		remove = true;
	} else if (ctx.hasUI) {
		const why =
			hasWork || unverifiable
				? `has work that removal would delete: ${workSummary}`
				: "was entered by path and is not managed by this session";
		const choice = await ctx.ui.select(`Worktree "${worktreeLabel(state)}" ${why}.`, [
			"Keep it for later",
			"Remove it and its branch",
			"Cancel",
		]);
		if (choice === undefined || choice.startsWith("Cancel"))
			throw new WorktreeCancelledError("Worktree exit cancelled.");
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
	let removed = false;

	if (remove) {
		const outcome = await worktreeRemove(pi, state.repoRoot, state.path, forceRemove);
		if (!outcome.ok) {
			lines.push(`Kept the worktree: ${outcome.error}`);
			// Re-lock so a concurrent prune cannot sweep a worktree we kept.
			if (state.lockReason) await lockWorktree(pi, state.repoRoot, state.path, state.lockReason);
			touchRecord(state.repoRoot, config, state.path);
		} else {
			removed = true;
			removeRecord(state.repoRoot, config, state.path);
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
					lines.push(deleted.ok ? `Deleted branch ${state.branch}` : `Kept branch ${state.branch}: ${deleted.error}`);
				}
			}
		}
	} else {
		lines.push(`Kept worktree ${state.path}`);
		if (state.branch) {
			// Name entry only reaches a managed worktree; a path the user pointed at is
			// re-entered through the tool.
			const label = worktreeLabel(state);
			lines.push(
				worktreePath(state.repoRoot, config, label) === state.path
					? `Re-enter with /worktree enter ${label}`
					: `Re-enter with \`worktree\` action \`enter\` (path: ${state.path}); /worktree enter only manages ${config.dir}`,
			);
		}
		touchRecord(state.repoRoot, config, state.path);
	}

	const handoff = await describeHandoff(pi, state, ahead);
	lines.push(...handoffLines(handoff));

	return { state, removed, handoff, output: lines.join("\n") };
}

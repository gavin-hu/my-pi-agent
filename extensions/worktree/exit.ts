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

/** What a branch holds relative to the branch a merge would land on. */
interface BranchStanding {
	/** The branch a merge would target, when one could be resolved. */
	base: string | null;
	/** Commits the branch holds that the base does not; undefined when it could not be counted. */
	ahead: number | undefined;
	/** Whether the base already contains the branch. */
	merged: boolean;
}

/**
 * Read the branch the exit may delete against the branch a merge would land on.
 *
 * Taken before removal, and in the main checkout: the branch ref outlives the
 * worktree directory, and it — not the checkout's `HEAD` — is what a delete takes.
 */
async function branchStanding(pi: ExtensionAPI, state: WorktreeState): Promise<BranchStanding> {
	const unknown: BranchStanding = { base: null, ahead: undefined, merged: false };
	if (!state.branch) return unknown;
	try {
		// `origin/HEAD` names the merge target when the repository has a remote; a
		// local-only repository has none, and the main checkout's own branch is the
		// branch a merge would actually land on.
		const base = (await defaultBranch(pi, state.repoRoot)) ?? (await currentBranch(pi, state.repoRoot)) ?? null;
		if (!base) return unknown;
		// Count against the resolved base branch, not the commit recorded at entry: a
		// worktree branch rebased onto a newer base would otherwise report every commit
		// the base gained since, as its own, and never look merged.
		const root = state.repoRoot;
		const ref = (await refExists(pi, root, base))
			? base
			: (await refExists(pi, root, `origin/${base}`))
				? `origin/${base}`
				: null;
		if (!ref) return { base, ahead: undefined, merged: false };
		const ahead = await commitsAheadOf(pi, root, state.branch, ref);
		return {
			base,
			ahead,
			merged: ahead === 0 && (await isBranchMerged(pi, root, state.branch, ref)),
		};
	} catch {
		return unknown;
	}
}

/**
 * The handoff a finished exit reports, from the facts the exit already took: a failed
 * lookup degrades to what is in hand rather than failing an exit that succeeded.
 */
function handoffFrom(state: WorktreeState, standing: BranchStanding, recorded?: number): Handoff {
	if (!state.branch) return { branch: null, base: null, ahead: recorded, merged: false };
	// `commits` is the count since the worktree was created, which only a recorded fork
	// point allows: without one the handoff has no "of its own" to report.
	const commits = state.baseCommit ? recorded : undefined;
	return {
		branch: state.branch,
		base: standing.base,
		// A base that could not be resolved leaves the created-at count as the only lead.
		ahead: standing.base === null ? recorded : standing.ahead,
		commits,
		merged: standing.merged && commits !== 0,
	};
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

	const { dirty, ahead, sub, unverifiable, hasWork } = await inspectWork(
		pi,
		state.path,
		state.baseCommit,
		state.branch,
	);
	// The commits the branch made since entry, asked of the branch by name: that is the
	// count the handoff's "created at" line is about, and the checkout's HEAD is not it.
	const recorded =
		state.baseCommit && state.branch ? await commitsAheadOf(pi, state.path, state.branch, state.baseCommit) : undefined;
	// The branch's standing is read while the directory is still there, so the delete
	// below and the handoff after it are one reading of the same count.
	const standing = await branchStanding(pi, state);
	const workSummary =
		`${dirty.length} changed file(s)` +
		((ahead ?? 0) > 0 ? `, ${ahead} new commit(s)` : "") +
		(sub.count > 0 ? `, ${sub.count} changed submodule file(s)` : "") +
		(unverifiable ? ", some work could not be inspected" : "");

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
	// removal discards, or commits the merge target does not contain. Only a count that
	// came back zero is proof of no work — an unrecorded fork point, a base branch git
	// could not name, and a refused count are each a reason to keep it.
	if (remove && dirty.length > 0) keepBranch = true;
	const keptFor = (): string => {
		if (standing.ahead === undefined) return "its commits could not be counted";
		if (!state.baseCommit) return "no fork point on record";
		return `${standing.ahead} commit(s) not merged`;
	};
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
				} else if (standing.ahead !== 0 || !state.baseCommit) {
					lines.push(`Kept branch ${state.branch} (${keptFor()}; delete it yourself if unwanted)`);
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

	const handoff = handoffFrom(state, standing, recorded);
	lines.push(...handoffLines(handoff));

	return { state, removed, handoff, output: lines.join("\n") };
}

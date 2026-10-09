/**
 * Session state for the worktree extension.
 *
 * State is persisted as a custom session entry so it follows the active branch:
 * navigating the session tree to before an `enter` naturally drops isolation,
 * and a resume/fork can restore or refuse the recorded worktree.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATE_ENTRY = "worktree";

export interface WorktreeState {
	active: boolean;
	/** Name of a managed worktree ("feature-auth"). Absent for foreign paths. */
	name?: string;
	/** Absolute path of the worktree. */
	path: string;
	/** Branch checked out in the worktree. */
	branch?: string;
	/** Main checkout to return to on exit. */
	repoRoot: string;
	/** Ref the worktree was branched from. */
	baseRef: string;
	/** Commit the worktree was based on, used to count new commits on exit. */
	baseCommit?: string;
	baseRefMode: "fresh" | "head";
	/** False when the user pointed us at a pre-existing worktree. */
	createdByUs: boolean;
	/** True when this session inherited the worktree from a parent process (subagent). */
	borrowed?: boolean;
	/** Reason used for `git worktree lock`, when we locked the worktree. */
	lockReason?: string;
}

/** Persist the current worktree state on the session branch. */
export function persistState(appendEntry: (customType: string, data?: unknown) => void, state: WorktreeState): void {
	appendEntry(STATE_ENTRY, state);
}

/** Reconstruct the last recorded worktree state from the active branch. */
export function loadState(ctx: ExtensionContext): WorktreeState | undefined {
	const entries = ctx.sessionManager.getBranch();
	let found: WorktreeState | undefined;
	for (const entry of entries) {
		const candidate = entry as { type?: string; customType?: string; data?: unknown };
		if (candidate.type !== "custom" || candidate.customType !== STATE_ENTRY) continue;
		const data = candidate.data as WorktreeState | undefined;
		if (data && typeof data === "object" && typeof data.path === "string") {
			found = data;
		}
	}
	return found;
}

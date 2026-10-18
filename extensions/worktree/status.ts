/**
 * Worktree status and reporting: labels, summaries, refusal messages, and the
 * override/`list_worktrees` view.
 */

import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { gapLines, isolationGaps } from "./gaps.ts";
import { canonicalize, type CheckoutCheck, defaultBranch, listManagedWorktrees, repoRoot } from "./git.ts";
import { reconcileRegistry, statusOf, type CheckoutStatus } from "./registry.ts";
import { configFor, getActive, getInactiveOverrides, getUnverifiableCommands } from "./runtime.ts";
import type { WorktreeState } from "./state.ts";

export function worktreeLabel(state: WorktreeState): string {
	return state.name ?? basename(state.path);
}

/**
 * The worktree/path/branch/main fact block shared by the status summary and
 * the injected prompt section. `pathLabel` and `column` preserve each
 * surface's existing alignment; `beforeMain` lets the status summary keep its
 * `base` line in place without duplicating the block.
 */
export function worktreeFacts(
	state: WorktreeState,
	pathLabel: string,
	column: number,
	beforeMain: string[] = [],
): string {
	return [
		`  ${`${pathLabel}:`.padEnd(column)}${state.path}`,
		`  ${"branch:".padEnd(column)}${state.branch ?? "(detached)"}`,
		...beforeMain,
		`  ${"main:".padEnd(column)}${state.repoRoot}`,
	].join("\n");
}

export function stateSummary(state: WorktreeState): string {
	const base = `  base:   ${state.baseRef} (${state.baseRefMode})`;
	return `Worktree: ${worktreeLabel(state)}\n${worktreeFacts(state, "path", 8, [base])}`;
}

/** Actionable message for a worktree the session refuses to restore. */
export function refusalMessage(check: CheckoutCheck, path: string, cwd: string): string {
	if (check.ok) return "";
	if (check.reason === "gone") {
		return `Worktree ${path} no longer exists; its binding was cleared and the session continues in ${cwd}.`;
	}
	if (check.reason === "unverified") {
		return (
			`Could not verify worktree ${path} (${check.detail}). The binding was kept; ` +
			`the session continues in ${cwd} without isolation. Resume again to retry.`
		);
	}
	return (
		`Refusing to use ${path} as a worktree: ${check.detail} ` +
		`Its binding was cleared and the session continues in ${cwd}. The directory may hold work; salvage it before removing.`
	);
}

/** Compact marks for one managed worktree in the status list. */
function statusMarks(status: CheckoutStatus, isCurrent: boolean): string[] {
	const marks: string[] = [];
	if (isCurrent) marks.push("current");
	if (status.state === "missing") marks.push("missing");
	if (status.locked) marks.push(status.staleLock ? "locked (stale)" : "locked");
	if (status.state === "dirty") marks.push(`dirty (${status.changed})`);
	if (status.ahead > 0) marks.push(`ahead ${status.ahead}`);
	if (status.behind > 0) marks.push(`behind ${status.behind}`);
	if (status.merged) marks.push("merged");
	if (status.lastUsedAt) marks.push(`used ${relativeDay(status.lastUsedAt)}`);
	return marks;
}

function relativeDay(at: number): string {
	const days = Math.floor((Date.now() - at) / 86_400_000);
	if (days <= 0) return "today";
	if (days === 1) return "1d ago";
	return `${days}d ago`;
}

/** Human-readable status: current worktree, override conflicts, gaps, managed worktrees. */
export async function worktreeStatus(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
	const current = getActive();
	const lines: string[] = [];
	if (current) {
		lines.push(stateSummary(current));
		if (current.borrowed) lines.push("  (inherited from the parent session)");
	} else {
		lines.push("Not in a worktree.");
	}
	const inactive = getInactiveOverrides();
	if (inactive.length > 0) {
		lines.push("", `Isolation not active for: ${inactive.join(", ")} (their default implementation is in use).`);
	}
	if (current) {
		// What isolation does not cover, from the same rules `doctor` reports: a gap
		// the user cannot see is a gap they cannot weigh.
		const gaps = isolationGaps({
			platform: process.platform,
			activeTools: pi.getActiveTools(),
			config: configFor(current.repoRoot),
			unverifiableCommands: getUnverifiableCommands(),
		});
		const gapBlock = gapLines(gaps);
		if (gapBlock.length > 0) lines.push("", "Not isolated:", ...gapBlock);
	}

	const root = current?.repoRoot ?? (await repoRoot(pi, ctx.cwd));
	if (root) {
		const config = loadConfig(root);
		const managed = await listManagedWorktrees(pi, root, config);
		const { registry } = reconcileRegistry(root, config, managed, { persist: false });
		const baseBranch = await defaultBranch(pi, root);
		const baseRef = baseBranch ? `origin/${baseBranch}` : undefined;
		lines.push("", `Managed worktrees (${managed.length}):`);
		for (const entry of managed) {
			const record = registry.worktrees.find((candidate) => candidate.path === canonicalize(entry.path));
			const status = await statusOf(pi, entry, { baseRef, record });
			const marks = statusMarks(status, current?.path === entry.path);
			lines.push(
				`  ${entry.path}  ${entry.branch ?? ""}${marks.length > 0 ? `  [${marks.join(", ")}]` : ""}`.trimEnd(),
			);
		}
	}
	return lines.join("\n");
}

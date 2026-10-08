/**
 * Worktree status and reporting: labels, summaries, refusal messages, and the
 * override/`list_worktrees` view.
 */

import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { canonicalize, type CheckoutCheck, defaultBranch, listManagedWorktrees, repoRoot } from "./git.ts";
import { reconcileRegistry, statusOf, type CheckoutStatus } from "./registry.ts";
import { ROOT_TOOL_NAMES } from "./root-tools.ts";
import { getActive, getInactiveOverrides } from "./runtime.ts";
import type { WorktreeState } from "./state.ts";

export function worktreeLabel(state: WorktreeState): string {
	return state.name ?? basename(state.path);
}

export function stateSummary(state: WorktreeState): string {
	return (
		`Worktree: ${worktreeLabel(state)}\n` +
		`  path:   ${state.path}\n` +
		`  branch: ${state.branch ?? "(detached)"}\n` +
		`  base:   ${state.baseRef} (${state.baseRefMode})\n` +
		`  main:   ${state.repoRoot}`
	);
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

/**
 * Find overridden tools that did not take effect, so their behavior is not
 * re-rooted into the worktree. Pi keeps the first registration per tool name
 * and refuses an extension that duplicates another extension's tool, so a
 * non-builtin source that is not us is unexpected but reported anyway.
 *
 * `self` is the extension entry file: Pi records it as the source of every
 * tool the extension registers, so it must be passed by `index.ts` rather than
 * derived from this module's own location.
 */
export function findInactiveOverrides(pi: ExtensionAPI, self: string | undefined): string[] {
	const inactive: string[] = [];
	for (const name of ROOT_TOOL_NAMES) {
		const info = pi.getAllTools().find((entry) => entry.name === name);
		if (!info) continue;
		const path = info.sourceInfo?.path;
		const isOurs = path && !path.startsWith("builtin:") && (!self || canonicalize(path) === self);
		if (!isOurs) inactive.push(name);
	}
	return inactive;
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

/** Human-readable status: current worktree, override conflicts, managed worktrees. */
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

	const root = current?.repoRoot ?? (await repoRoot(pi, ctx.cwd));
	if (root) {
		const config = loadConfig(root);
		const managed = await listManagedWorktrees(pi, root, config);
		const { registry } = reconcileRegistry(root, config, managed);
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

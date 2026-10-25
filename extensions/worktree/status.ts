/**
 * Worktree status and reporting: labels, summaries, refusal messages, and the
 * override/`list_worktrees` view.
 *
 * One snapshot feeds both surfaces: `formatWorktreeStatus` renders it as the text
 * a tool result or a headless command prints, and `screen.ts` renders the same
 * rows as the `/worktree` list screen. They read the same git calls, so they
 * cannot disagree about a worktree.
 */

import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mapConcurrent } from "../../lib/pool.ts";
import { loadConfig } from "./config.ts";
import { gapLines, type IsolationGap, isolationGaps } from "./gaps.ts";
import { type CheckoutCheck, defaultBranch, listManagedWorktrees, type ManagedWorktree, repoRoot } from "./git.ts";
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
export function statusMarks(status: CheckoutStatus, isCurrent: boolean): string[] {
	const marks: string[] = [];
	if (isCurrent) marks.push("current");
	if (status.state === "missing") marks.push("missing");
	if (status.locked) marks.push(status.staleLock ? "locked (stale)" : "locked");
	if (status.state === "dirty") marks.push(`dirty (${status.changed})`);
	if (status.ahead > 0) marks.push(`ahead ${status.ahead}`);
	if (status.behind > 0) marks.push(`behind ${status.behind}`);
	// A merged mark claims the work landed; with no commits of its own the worktree is an
	// empty checkout, and saying so is the difference between "nothing here yet" and "done".
	// How many commits landed is the number that mark is about, so it goes beside it.
	if (status.commits === 0) marks.push("no commits");
	else if (status.merged) marks.push(...(status.commits === undefined ? [] : [`commits ${status.commits}`]), "merged");
	if (status.lastUsedAt) marks.push(`used ${relativeDay(status.lastUsedAt)}`);
	return marks;
}

export function relativeDay(at: number): string {
	const days = Math.floor((Date.now() - at) / 86_400_000);
	if (days <= 0) return "today";
	if (days === 1) return "1d ago";
	return `${days}d ago`;
}

/** One managed worktree and what git says about it. */
export interface ManagedRow {
	entry: ManagedWorktree;
	status: CheckoutStatus;
}

/** Everything both status surfaces report, read once. */
export interface WorktreeSnapshot {
	active: WorktreeState | null;
	/** What isolation does not cover, from the same rules `doctor` reports. */
	gaps: IsolationGap[];
	/** Built-in tools with an inactive override. */
	inactiveOverrides: string[];
	/** Managed worktrees with their checkout status, in git's order. */
	managed: ManagedRow[];
	/** The merge-target branch name, when the repository has a remote. */
	baseBranch: string | undefined;
}

/** Read the session's worktree status once, for either surface to render. */
export async function worktreeSnapshot(pi: ExtensionAPI, ctx: ExtensionContext): Promise<WorktreeSnapshot> {
	const active = getActive();
	// A gap the user cannot see is a gap they cannot weigh, so they are computed for
	// every read rather than cached from session start.
	const gaps = active
		? isolationGaps({
				platform: process.platform,
				activeTools: pi.getActiveTools(),
				config: configFor(active.repoRoot),
				unverifiableCommands: getUnverifiableCommands(),
			})
		: [];

	const managed: ManagedRow[] = [];
	let baseBranch: string | undefined;
	const root = active?.repoRoot ?? (await repoRoot(pi, ctx.cwd));
	if (root) {
		const config = loadConfig(root);
		const entries = await listManagedWorktrees(pi, root, config);
		const { registry } = reconcileRegistry(root, config, entries, { persist: false });
		baseBranch = await defaultBranch(pi, root);
		const baseRef = baseBranch ? `origin/${baseBranch}` : undefined;
		// Keyed by the canonical path the registry stores, so a row's record is one
		// lookup instead of a scan of every record.
		const records = new Map(registry.worktrees.map((record) => [record.path, record]));
		const row = async (entry: ManagedWorktree): Promise<ManagedRow> => {
			return { entry, status: await statusOf(pi, entry, { baseRef, record: records.get(entry.path) }) };
		};
		// Each row is up to four git reads; four at a time keeps the list in the order
		// git reports while overlapping the waits. `statusOf` passes no `env`, which is
		// what makes concurrent git calls safe here (see `RunGitOptions.env`).
		managed.push(...(await mapConcurrent(entries, 4, row)));
	}

	return { active, gaps, inactiveOverrides: getInactiveOverrides(), managed, baseBranch };
}

/** Human-readable status: current worktree, override conflicts, gaps, managed worktrees. */
export function formatWorktreeStatus(snapshot: WorktreeSnapshot): string {
	const { active, gaps, inactiveOverrides, managed } = snapshot;
	const lines: string[] = [];
	if (active) {
		lines.push(stateSummary(active));
		if (active.borrowed) lines.push("  (inherited from the parent session)");
	} else {
		lines.push("Not in a worktree.");
	}
	if (inactiveOverrides.length > 0) {
		lines.push(
			"",
			`Isolation not active for: ${inactiveOverrides.join(", ")} (their default implementation is in use).`,
		);
	}
	const gapBlock = gapLines(gaps);
	if (gapBlock.length > 0) lines.push("", "Not isolated:", ...gapBlock);

	if (managed.length > 0) {
		const row = (item: ManagedRow): string => {
			const marks = statusMarks(item.status, active?.path === item.entry.path);
			return `  ${item.entry.path}  ${item.entry.branch ?? ""}${marks.length > 0 ? `  [${marks.join(", ")}]` : ""}`.trimEnd();
		};
		lines.push("", `Managed worktrees (${managed.length}):`, ...managed.map(row));
	}
	return lines.join("\n");
}

/** Read the status and render it: what the `list_worktrees` tool and a headless `/worktree` print. */
export async function worktreeStatus(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
	return formatWorktreeStatus(await worktreeSnapshot(pi, ctx));
}

/**
 * Worktree lifecycle: enter, exit, prune, and status.
 *
 * These are stateless functions over the shared runtime state in `runtime.ts`;
 * the extension's tools, commands, and event handlers call them.
 */

import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, type WorktreeConfig } from "./config.ts";
import {
	branchExists,
	canonicalize,
	type CheckoutCheck,
	commitsAhead,
	currentBranch,
	defaultBranch,
	deleteBranch,
	fetchPrRef,
	hasCommits,
	isProcessAlive,
	listManagedWorktrees,
	lockWorktree,
	mergeBase,
	parsePrReference,
	type PrReference,
	repoRoot,
	resetHard,
	resolveBaseRef,
	statusEntries,
	submoduleChanges,
	unlockWorktree,
	worktreeAdd,
	worktreeExists,
	worktreePath,
	worktreeRemove,
} from "./git.ts";
import { isInside } from "./guard.ts";
import { copyIncludes, includePatterns } from "./include.ts";
import { ROOT_TOOL_NAMES } from "./root-tools.ts";
import { persistState, type WorktreeState } from "./state.ts";
import {
	applyWorktreeEnv,
	clearConfigCache,
	getActive,
	getInactiveOverrides,
	isGitignoreOffered,
	lockReasonFor,
	markGitignoreOffered,
	publishWorktree,
	setActive,
	setBaseCwd,
	setStatus,
} from "./runtime.ts";

export function worktreeLabel(state: WorktreeState): string {
	return state.name ?? basename(state.path);
}

function stateSummary(state: WorktreeState): string {
	return (
		`Worktree: ${worktreeLabel(state)}\n` +
		`  path:   ${state.path}\n` +
		`  branch: ${state.branch ?? "(detached)"}\n` +
		`  base:   ${state.baseRef} (${state.baseRefMode})\n` +
		`  main:   ${state.repoRoot}`
	);
}

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

// ---------------------------------------------------------------------------
// Enter
// ---------------------------------------------------------------------------

function generateName(): string {
	const adjectives = ["bright", "quiet", "swift", "calm", "bold", "lucky", "clever", "gentle"];
	const animals = ["fox", "otter", "heron", "lynx", "robin", "marten", "badger", "kite"];
	const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
	return `${pick(adjectives)}-${pick(animals)}-${Math.floor(Math.random() * 900 + 100)}`;
}

/** Offer once per session to ignore the managed worktree directory. */
async function maybeIgnoreWorktreeDir(
	ctx: ExtensionContext,
	root: string,
	config: WorktreeConfig,
): Promise<void> {
	if (isGitignoreOffered()) return;
	if (!ctx.hasUI) return;
	markGitignoreOffered();

	const entry = `${config.dir.replace(/\/+$/, "")}/`;
	const gitignorePath = join(root, ".gitignore");
	let content = "";
	try {
		content = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
	} catch {
		return;
	}
	if (content.split(/\r?\n/).some((line) => line.trim() === entry || line.trim() === config.dir)) return;

	const confirmed = await ctx.ui.confirm(
		"Add the worktree directory to .gitignore?",
		`${entry} is not ignored, so worktrees show up as untracked files in the main checkout.`,
	);
	if (!confirmed) return;
	try {
		appendFileSync(gitignorePath, `${content.length > 0 && !content.endsWith("\n") ? "\n" : ""}${entry}\n`);
		ctx.ui.notify(`Added ${entry} to .gitignore`, "info");
	} catch {
		// A read-only .gitignore should not fail the enter.
	}
}

export interface EnterOptions {
	name?: string;
	path?: string;
}

async function resolveCommit(pi: ExtensionAPI, dir: string, ref: string): Promise<string | undefined> {
	try {
		const result = await pi.exec("git", ["rev-parse", ref], { cwd: dir });
		return result.code === 0 ? result.stdout.trim() : undefined;
	} catch {
		return undefined;
	}
}

/** Create or enter a worktree and rebind the session's effective root. */
export async function enterWorktree(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: EnterOptions,
): Promise<{ state: WorktreeState; summary: string }> {
	const current = getActive();
	if (current?.borrowed) {
		throw new Error("This session inherited a worktree from its parent process; only the parent can change it.");
	}
	if (current) {
		throw new Error(
			`Already working in a worktree (${worktreeLabel(current)}). ` +
				`Call worktree_exit first, or use worktree_enter with "path" to switch managed worktrees.`,
		);
	}

	const root = await repoRoot(pi, ctx.cwd);
	if (!root) throw new Error(`Not a git repository: ${ctx.cwd}`);
	if (!(await hasCommits(pi, root))) {
		throw new Error("This repository has no commits yet; a worktree needs a commit to branch from.");
	}

	clearConfigCache();
	const config = loadConfig(root);
	let name = options.name?.trim() || undefined;
	const pathArg = options.path?.trim() || undefined;
	if (name && pathArg) throw new Error('"name" and "path" are mutually exclusive.');

	// A pull/merge request reference can arrive as `#1234` or a host URL.
	const prRef: PrReference | undefined = name ? parsePrReference(name) : undefined;

	let target: string;
	let branch: string | undefined;
	let createdByUs = true;

	if (pathArg) {
		target = canonicalize(resolve(ctx.cwd, pathArg));
		if (target === canonicalize(root)) {
			throw new Error("The main checkout is not a worktree; enter a separate worktree path.");
		}
		const managedRoot = canonicalize(resolve(root, config.dir));
		if (!isInside(managedRoot, target)) {
			if (!ctx.hasUI) throw new Error(`Refusing to enter ${target} outside ${managedRoot} without confirmation.`);
			const ok = await ctx.ui.confirm(
				"Enter worktree outside the managed directory?",
				`${target}\n\nThis moves the session's working directory and write access there.`,
			);
			if (!ok) throw new Error("Worktree entry cancelled.");
		}
		if (!(await worktreeExists(pi, target))) {
			throw new Error(`No git worktree found at ${target}.`);
		}
		branch = await currentBranch(pi, target);
		createdByUs = false;
	} else {
		if (prRef) name = `pr-${prRef.number}`;
		if (!name) name = generateName();
		target = worktreePath(root, config, name);
		branch = `${config.branchPrefix}${name}`;
	}

	let baseRef = "HEAD";
	let baseRefMode: "fresh" | "head" = "head";
	let baseCommit: string | undefined;
	const existed = await worktreeExists(pi, target);

	if (!existed) {
		if (prRef) {
			const fetched = await fetchPrRef(pi, root, prRef, config.fetchTimeoutMs);
			if (!fetched.ok) throw new Error(fetched.error);
			baseRef = "FETCH_HEAD";
			baseRefMode = "fresh";
		} else {
			const base = await resolveBaseRef(pi, root, config);
			baseRef = base.ref;
			baseRefMode = base.mode;
		}
		const targetBranch = branch ?? `${config.branchPrefix}${basename(target)}`;
		// A branch kept by an earlier exit already exists; attach it instead of
		// failing on `-b`, and treat its tip as the base for exit checks.
		const createBranch = !(await branchExists(pi, root, targetBranch));
		if (!createBranch) {
			baseRef = targetBranch;
			baseRefMode = "head";
		}
		const created = await worktreeAdd(pi, root, target, targetBranch, baseRef, createBranch);
		if (!created.ok) {
			throw new Error(`Failed to create worktree at ${target}:\n${created.error}`);
		}
		baseCommit = await resolveCommit(pi, target, baseRef);
	} else {
		branch = branch ?? (await currentBranch(pi, target));
		// Reuse rules: a clean worktree still on its generated branch, with no
		// commits of its own, is reset to the fresh base; otherwise it reopens
		// at its old tip.
		if (config.baseRef === "fresh" && name && branch === `${config.branchPrefix}${name}`) {
			const base = await resolveBaseRef(pi, root, config);
			baseRef = base.ref;
			baseRefMode = base.mode;
			const clean = (await statusEntries(pi, target)).length === 0;
			const ahead = await commitsAhead(pi, target, base.ref);
			if (clean && ahead === 0) {
				await resetHard(pi, target, base.ref);
				baseCommit = await resolveCommit(pi, target, base.ref);
			} else {
				baseCommit = await mergeBase(pi, target, base.ref);
			}
		} else {
			baseCommit = await resolveCommit(pi, target, baseRef);
		}
	}

	let copiedIncludes: string[] = [];
	if (!existed) {
		copiedIncludes = await copyIncludes(pi, root, target, includePatterns(root, config.include), config.dir);
		await maybeIgnoreWorktreeDir(ctx, root, config);
	}

	const state: WorktreeState = {
		active: true,
		name: name ?? basename(target),
		path: target,
		branch,
		repoRoot: root,
		baseRef,
		baseRefMode,
		baseCommit,
		createdByUs,
	};
	const lockReason = lockReasonFor(ctx);
	if (createdByUs && (await lockWorktree(pi, root, target, lockReason))) {
		state.lockReason = lockReason;
	}
	setActive(state);
	setBaseCwd(ctx.cwd);
	persistState((customType, data) => pi.appendEntry(customType, data), state);
	applyWorktreeEnv(state);
	publishWorktree(pi, state);
	setStatus(ctx, `⧉ ${worktreeLabel(state)}`);
	ctx.ui.notify(`Entered worktree ${worktreeLabel(state)}`, "info");
	const summary =
		`Entered worktree.\n${stateSummary(state)}\n\n` +
		`Relative paths now resolve inside the worktree. When finished, call worktree_exit.` +
		(copiedIncludes.length > 0 ? `\n\nCopied ${copiedIncludes.length} gitignored file(s).` : "");
	return { state, summary };
}

// ---------------------------------------------------------------------------
// Exit
// ---------------------------------------------------------------------------

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

	const dirty = await statusEntries(pi, state.path);
	const ahead = state.baseCommit ? await commitsAhead(pi, state.path, state.baseCommit) : 0;
	const sub = await submoduleChanges(pi, state.path);
	const unverifiable = !sub.known;
	const hasWork = dirty.length > 0 || ahead > 0 || sub.count > 0;
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

// ---------------------------------------------------------------------------
// Prune
// ---------------------------------------------------------------------------

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
		const ahead = await commitsAhead(pi, entry.path, fork);
		const dirty = await statusEntries(pi, entry.path);
		const sub = await submoduleChanges(pi, entry.path);
		if (ahead !== 0 || dirty.length > 0 || sub.count > 0 || !sub.known) {
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

	return [
		...removed.map((path) => `Removed ${path}`),
		...kept.map((path) => `Kept ${path}`),
	].join("\n") || "Nothing to prune.";
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

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
		lines.push("", `Managed worktrees (${managed.length}):`);
		for (const entry of managed) {
			const marks = [current?.path === entry.path ? "current" : "", entry.locked !== undefined ? "locked" : ""]
				.filter(Boolean)
				.join(", ");
			lines.push(`  ${entry.path}  ${entry.branch ?? ""}${marks ? `  [${marks}]` : ""}`.trimEnd());
		}
	}
	return lines.join("\n");
}

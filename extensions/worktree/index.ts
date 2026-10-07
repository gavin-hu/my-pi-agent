/**
 * pi-worktree — Isolated git worktrees (EnterWorktree / ExitWorktree) for Pi.
 *
 * Mimics Claude Code's worktree isolation:
 *   - `worktree_enter` creates (or enters) an isolated `git worktree` under
 *     `.pi/worktrees/<name>` on branch `worktree-<name>`, and rebinds every
 *     path-taking tool to it.
 *   - `worktree_exit` returns to the main checkout and cleans up, checking for
 *     uncommitted work and unpushed commits first.
 *
 * Pi has no mutable session cwd and its built-ins capture cwd at construction,
 * so isolation is implemented by overriding the built-in tools at load time
 * (`root-tools.ts`) and re-rooting them at call time through `activeRoot`.
 *
 * Load with:  pi --extension ./worktree
 */

import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, type WorktreeConfig } from "./config.ts";
import {
	branchExists,
	canonicalize,
	type CheckoutCheck,
	checkCheckout,
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
import { analyzeBashCommand, guardFileTool, isInside } from "./guard.ts";
import { copyIncludes, includePatterns } from "./include.ts";
import { registerRootTools, ROOT_TOOL_NAMES } from "./root-tools.ts";
import { loadState, persistState, type WorktreeState } from "./state.ts";

const STATUS_KEY = "worktree";

/** Environment variables a parent session passes to child processes (subagents). */
const ENV_ROOT = "PI_WORKTREE_ROOT";
const ENV_BRANCH = "PI_WORKTREE_BRANCH";

/** Cross-extension notification channel. */
export const WORKTREE_EVENT_CHANNEL = "worktree:changed";

// ---------------------------------------------------------------------------
// Active state
// ---------------------------------------------------------------------------

let active: WorktreeState | null = null;
/** Directory to use when not isolated (the session cwd at startup). */
let baseCwd = process.cwd();

const configCache = new Map<string, WorktreeConfig>();
/** Cached config for the hot `tool_call` path; cleared on enter and exit. */
function configFor(root: string): WorktreeConfig {
	let config = configCache.get(root);
	if (!config) {
		config = loadConfig(root);
		configCache.set(root, config);
	}
	return config;
}

function getRoot(): string {
	return active ? active.path : baseCwd;
}

function getSkipOverrides(): string[] {
	try {
		return loadConfig(active?.repoRoot ?? baseCwd).skipOverrides;
	} catch {
		return [];
	}
}

function setStatus(ctx: ExtensionContext, text: string | undefined): void {
	try {
		ctx.ui.setStatus(STATUS_KEY, text);
	} catch {
		// UI may be unavailable (print/json modes, shutdown).
	}
}

function lockReasonFor(ctx: ExtensionContext): string {
	return `pi:${process.pid}:${ctx.sessionManager.getSessionId()}`;
}

/** Notify other extensions (and the subagent extension) about the active worktree. */
function publishWorktree(pi: ExtensionAPI, state: WorktreeState | null): void {
	try {
		pi.events.emit(
			WORKTREE_EVENT_CHANNEL,
			state ? { active: true, path: state.path, branch: state.branch, borrowed: !!state.borrowed } : { active: false },
		);
	} catch {
		// Event bus is optional.
	}
}

/**
 * Export the active worktree to the process environment. Child `pi` processes
 * (subagents) inherit it and bind to the same worktree instead of the main
 * checkout; see the borrowed-worktree path in `session_start`.
 */
function applyWorktreeEnv(state: WorktreeState | null): void {
	if (state && !state.borrowed) {
		process.env[ENV_ROOT] = state.path;
		if (state.branch) process.env[ENV_BRANCH] = state.branch;
		else delete process.env[ENV_BRANCH];
		return;
	}
	if (!state) {
		delete process.env[ENV_ROOT];
		delete process.env[ENV_BRANCH];
	}
}

function worktreeLabel(state: WorktreeState): string {
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
function refusalMessage(check: CheckoutCheck, path: string, cwd: string): string {
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
// Enter / exit
// ---------------------------------------------------------------------------

function generateName(): string {
	const adjectives = ["bright", "quiet", "swift", "calm", "bold", "lucky", "clever", "gentle"];
	const animals = ["fox", "otter", "heron", "lynx", "robin", "marten", "badger", "kite"];
	const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
	return `${pick(adjectives)}-${pick(animals)}-${Math.floor(Math.random() * 900 + 100)}`;
}

let gitignoreOffered = false;

/** Offer once per session to ignore the managed worktree directory. */
async function maybeIgnoreWorktreeDir(
	ctx: ExtensionContext,
	repoRoot: string,
	config: WorktreeConfig,
): Promise<void> {
	if (gitignoreOffered) return;
	if (!ctx.hasUI) return;
	gitignoreOffered = true;

	const entry = `${config.dir.replace(/\/+$/, "")}/`;
	const gitignorePath = join(repoRoot, ".gitignore");
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

/** Create or enter a worktree and rebind the session's effective root. */
async function enterWorktree(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: EnterOptions,
): Promise<{ state: WorktreeState; summary: string }> {
	if (active?.borrowed) {
		throw new Error("This session inherited a worktree from its parent process; only the parent can change it.");
	}
	if (active) {
		throw new Error(
			`Already working in a worktree (${worktreeLabel(active)}). ` +
				`Call worktree_exit first, or use worktree_enter with "path" to switch managed worktrees.`,
		);
	}

	const root = await repoRoot(pi, ctx.cwd);
	if (!root) throw new Error(`Not a git repository: ${ctx.cwd}`);
	if (!(await hasCommits(pi, root))) {
		throw new Error("This repository has no commits yet; a worktree needs a commit to branch from.");
	}

	configCache.clear();
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

	active = {
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
		active.lockReason = lockReason;
	}
	baseCwd = ctx.cwd;
	persistState((customType, data) => pi.appendEntry(customType, data), active);
	applyWorktreeEnv(active);
	publishWorktree(pi, active);
	setStatus(ctx, `🌳 ${worktreeLabel(active)}`);
	ctx.ui.notify(`Entered worktree ${worktreeLabel(active)}`, "info");
	const summary =
		`Entered worktree.\n${stateSummary(active)}\n\n` +
		`Relative paths now resolve inside the worktree. When finished, call worktree_exit.` +
		(copiedIncludes.length > 0 ? `\n\nCopied ${copiedIncludes.length} gitignored file(s).` : "");
	return { state: active, summary };
}

async function resolveCommit(pi: ExtensionAPI, dir: string, ref: string): Promise<string | undefined> {
	try {
		const result = await pi.exec("git", ["rev-parse", ref], { cwd: dir });
		return result.code === 0 ? result.stdout.trim() : undefined;
	} catch {
		return undefined;
	}
}

export interface ExitOptions {
	remove?: boolean;
	keepBranch?: boolean;
}

async function exitWorktree(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: ExitOptions,
): Promise<{ state: WorktreeState; removed: boolean; output: string }> {
	if (!active) throw new Error("Not currently in a worktree.");
	if (active.borrowed) {
		throw new Error("This worktree was inherited from the parent session, which owns it. Ask the parent to call worktree_exit.");
	}
	const state = active;
	configCache.clear();
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

	active = null;
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

/** Remove clean, unused managed worktrees past the prune age. Returns a report. */
async function pruneWorktrees(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
	const root = await repoRoot(pi, ctx.cwd);
	if (!root) return "Not a git repository.";
	const config = loadConfig(root);
	const managed = await listManagedWorktrees(pi, root, config);
	const branch = await defaultBranch(pi, root);
	const removed: string[] = [];
	const kept: string[] = [];

	for (const entry of managed) {
		if (active?.path === entry.path) {
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

/**
 * Overridden tools whose effective implementation is not ours, because
 * `skipOverrides` excluded them or the config could not be read. Pi refuses to
 * load two extensions that register the same tool name, so this is not an
 * extension-versus-extension conflict; it means that tool keeps its default
 * behavior and is not re-rooted.
 */
let inactiveOverrides: string[] = [];

/** Path of this extension file, used to tell our tool registrations from others'. */
function extensionPath(): string | undefined {
	try {
		return canonicalize(fileURLToPath(import.meta.url));
	} catch {
		return undefined;
	}
}

/**
 * Find overridden tools that did not take effect, so their behavior is not
 * re-rooted into the worktree. Pi keeps the first registration per tool name
 * and refuses an extension that duplicates another extension's tool, so a
 * non-builtin source that is not us is unexpected but reported anyway.
 */
function findInactiveOverrides(pi: ExtensionAPI): string[] {
	const self = extensionPath();
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
async function worktreeStatus(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
	const lines: string[] = [];
	if (active) {
		lines.push(stateSummary(active));
		if (active.borrowed) lines.push("  (inherited from the parent session)");
	} else {
		lines.push("Not in a worktree.");
	}
	if (inactiveOverrides.length > 0) {
		lines.push("", `Isolation not active for: ${inactiveOverrides.join(", ")} (their default implementation is in use).`);
	}

	const root = active?.repoRoot ?? (await repoRoot(pi, ctx.cwd));
	if (root) {
		const config = loadConfig(root);
		const managed = await listManagedWorktrees(pi, root, config);
		lines.push("", `Managed worktrees (${managed.length}):`);
		for (const entry of managed) {
			const marks = [active?.path === entry.path ? "current" : "", entry.locked !== undefined ? "locked" : ""]
				.filter(Boolean)
				.join(", ");
			lines.push(`  ${entry.path}  ${entry.branch ?? ""}${marks ? `  [${marks}]` : ""}`.trimEnd());
		}
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	registerRootTools(pi, { getRoot, getSkipOverrides });

	pi.registerFlag("worktree", {
		description: "Create or enter a git worktree at session start",
		type: "string",
	});

	// --- lifecycle ---------------------------------------------------------

	pi.on("session_start", async (event, ctx) => {
		baseCwd = ctx.cwd;
		active = null;

		// A child `pi` process (subagent) inherits an active worktree. Bind to
		// it without creating, locking, or persisting anything; the parent owns
		// the lifecycle. Only on a fresh process start: a `reload` re-runs this
		// factory inside the parent, which must restore its own recorded state.
		const envRoot = event.reason === "startup" ? process.env[ENV_ROOT] : undefined;
		if (envRoot) {
			const borrowedPath = canonicalize(envRoot);
			if (existsSync(borrowedPath) && (await repoRoot(pi, borrowedPath))) {
				active = {
					active: true,
					borrowed: true,
					path: borrowedPath,
					branch: process.env[ENV_BRANCH],
					repoRoot: borrowedPath,
					baseRef: "HEAD",
					baseRefMode: "head",
					createdByUs: false,
				};
				setStatus(ctx, `🌳 ${worktreeLabel(active)} (inherited)`);
				publishWorktree(pi, active);
				ctx.ui.notify(`Using parent worktree ${active.path}`, "info");
			} else {
				delete process.env[ENV_ROOT];
				delete process.env[ENV_BRANCH];
			}
		}

		const recorded = loadState(ctx);
		if (!active && recorded?.active) {
			const check = await checkCheckout(pi, recorded.path, recorded.repoRoot);
			if (check.ok) {
				active = recorded;
				setStatus(ctx, `🌳 ${worktreeLabel(active)}`);
				ctx.ui.notify(`Restored worktree ${worktreeLabel(active)}`, "info");
			} else {
				persistState((customType, data) => pi.appendEntry(customType, data), { ...recorded, active: false });
				setStatus(ctx, undefined);
				ctx.ui.notify(refusalMessage(check, recorded.path, ctx.cwd), "warning");
			}
		} else if (!active) {
			setStatus(ctx, undefined);
		}

		inactiveOverrides = findInactiveOverrides(pi);
		if (inactiveOverrides.length > 0) {
			ctx.ui.notify(
				`Worktree isolation is not active for: ${inactiveOverrides.join(", ")}. Those tools keep their default behavior; set skipOverrides or remove the conflicting extension.`,
				"warning",
			);
		}

		if (event.reason === "startup" && !active) {
			const flag = pi.getFlag("worktree");
			if (typeof flag === "string" && flag.trim()) {
				const name = flag.trim() === "true" ? undefined : flag.trim();
				try {
					await enterWorktree(pi, ctx, { name });
				} catch (error) {
					ctx.ui.notify(`Could not enter worktree: ${(error as Error).message}`, "error");
				}
			}
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		// Release our lock but never remove the worktree on shutdown; cleanup is
		// an explicit exit or `/worktree-prune`.
		if (active && !active.borrowed && active.lockReason) {
			try {
				await unlockWorktree(pi, active.repoRoot, active.path);
			} catch {
				// Shutdown must not throw.
			}
		}
		setStatus(ctx, undefined);
	});

	pi.on("before_agent_start", (event) => {
		if (!active) return;
		event.systemPromptOptions.cwd = active.path;
		event.systemPromptOptions.sections = {
			...event.systemPromptOptions.sections,
			worktree:
				`You are working in an isolated git worktree; relative paths resolve there, not in the main checkout.\n` +
				`  worktree: ${active.path}\n` +
				`  branch:   ${active.branch ?? "(detached)"}\n` +
				`  main:     ${active.repoRoot}\n` +
				`Do not edit files or run git against the main checkout.` +
				(active.borrowed
					? "\nThis worktree was inherited from the parent session; do not try to exit it."
					: "\nUse worktree_exit to return."),
		};
	});

	pi.on("tool_call", (event) => {
		if (!active) return;
		const config = configFor(active.repoRoot);
		if (event.toolName === "bash") {
			const command = (event.input as { command?: string }).command ?? "";
			return analyzeBashCommand(command, active.path, config);
		}
		return guardFileTool(event.toolName, event.input, active.path, config);
	});

	// --- tools -------------------------------------------------------------

	pi.registerTool({
		name: "worktree_enter",
		label: "Enter worktree",
		description:
			"Use this tool ONLY when explicitly instructed to work in a git worktree, either by the user or by project " +
			"instructions. It creates an isolated git worktree and switches the session's working directory into it, so " +
			"edits stay isolated from the main checkout. Pass `name` to create a new worktree, or `path` to switch into an " +
			"existing worktree. The tool errors if the session is already isolated; call worktree_exit first.",
		parameters: Type.Object({
			name: Type.Optional(
				Type.String({ description: "Name for a new worktree (branch worktree-<name>, directory .pi/worktrees/<name>)." }),
			),
			path: Type.Optional(
				Type.String({ description: "Absolute or repo-relative path of an existing worktree to enter instead of creating one." }),
			),
		}),
		annotations: { destructiveHint: true, openWorldHint: true },
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { state, summary } = await enterWorktree(pi, ctx, { name: params.name, path: params.path });
			return {
				content: [{ type: "text", text: summary }],
				details: { state },
			};
		},
	});

	pi.registerTool({
		name: "worktree_exit",
		label: "Exit worktree",
		description:
			"Leave the current git worktree and return to the main checkout. The worktree is removed when it is clean; " +
			"when it has uncommitted changes or new commits the user is asked whether to keep it. Use this after merging " +
			"or finishing work started with worktree_enter.",
		parameters: Type.Object({
			remove: Type.Optional(Type.Boolean({ description: "Force removal (or keep when false) without prompting." })),
			keepBranch: Type.Optional(Type.Boolean({ description: "Keep the worktree branch when removing." })),
		}),
		annotations: { destructiveHint: true, openWorldHint: false },
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await exitWorktree(pi, ctx, { remove: params.remove, keepBranch: params.keepBranch });
			return {
				content: [{ type: "text", text: result.output }],
				details: { state: result.state, removed: result.removed },
			};
		},
	});

	pi.registerTool({
		name: "worktree_prune",
		label: "Prune worktrees",
		description:
			"Remove managed git worktrees that are clean, have no new commits, are not the current worktree, are not " +
			"locked by a live process, and are older than the configured pruneAfterDays. Worktrees with any work are kept.",
		parameters: Type.Object({}),
		annotations: { destructiveHint: true, openWorldHint: false },
		executionMode: "sequential",
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return { content: [{ type: "text", text: await pruneWorktrees(pi, ctx) }], details: {} };
		},
	});

	pi.registerTool({
		name: "worktree_status",
		label: "Worktree status",
		description:
			"Report whether the session is isolated in a git worktree, its path and branch, any isolation overrides that " +
			"are not active, and the managed worktrees on disk. Read-only; use it before assuming you are or are not isolated.",
		parameters: Type.Object({}),
		annotations: { readOnlyHint: true, openWorldHint: false },
		executionMode: "sequential",
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return {
				content: [{ type: "text", text: await worktreeStatus(pi, ctx) }],
				details: {
					active: active ? { path: active.path, branch: active.branch, borrowed: !!active.borrowed } : null,
					inactiveOverrides,
				},
			};
		},
	});

	// --- commands ----------------------------------------------------------

	pi.registerCommand("worktree", {
		description: "Show the current worktree and list managed worktrees",
		handler: async (_args, ctx) => {
			ctx.ui.notify(await worktreeStatus(pi, ctx), "info");
		},
	});

	pi.registerCommand("worktree-enter", {
		description: "Enter a git worktree: /worktree-enter [name]",
		handler: async (args, ctx) => {
			const name = args.trim().split(/\s+/)[0] || undefined;
			try {
				const { state } = await enterWorktree(pi, ctx, { name });
				ctx.ui.notify(`Entered worktree ${worktreeLabel(state)}\n${state.path}`, "info");
			} catch (error) {
				ctx.ui.notify(`Enter failed: ${(error as Error).message}`, "error");
			}
		},
	});

	pi.registerCommand("worktree-exit", {
		description: "Exit the current worktree: /worktree-exit [--keep|--remove]",
		handler: async (args, ctx) => {
			const remove = args.includes("--remove") ? true : args.includes("--keep") ? false : undefined;
			try {
				const result = await exitWorktree(pi, ctx, { remove });
				ctx.ui.notify(result.output, "info");
			} catch (error) {
				ctx.ui.notify(`Exit failed: ${(error as Error).message}`, "error");
			}
		},
	});

	pi.registerCommand("worktree-prune", {
		description: "Remove clean, unused managed worktrees older than pruneAfterDays",
		handler: async (_args, ctx) => {
			ctx.ui.notify(await pruneWorktrees(pi, ctx), "info");
		},
	});
}

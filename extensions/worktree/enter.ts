/**
 * Worktree entry (and creation): bind the session to a worktree and rebind its
 * effective root.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, type WorktreeConfig } from "./config.ts";
import {
	branchExists,
	canonicalize,
	commitsAhead,
	currentBranch,
	fetchPrRef,
	hasCommits,
	lockWorktree,
	mergeBase,
	parsePrReference,
	type PrReference,
	repoRoot,
	resetHard,
	resolveBaseRef,
	statusEntries,
	worktreeAdd,
	worktreeExists,
	worktreePath,
} from "./git.ts";
import { isInside } from "./guard.ts";
import { copyIncludes, includePatterns } from "./include.ts";
import {
	applyWorktreeEnv,
	clearConfigCache,
	getActive,
	isGitignoreOffered,
	lockReasonFor,
	markGitignoreOffered,
	publishWorktree,
	setActive,
	setBaseCwd,
	setStatus,
} from "./runtime.ts";
import { persistState, type WorktreeState } from "./state.ts";
import { stateSummary, worktreeLabel } from "./status.ts";

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
			// A pre-existing or non-reset worktree keeps its own history. Record
			// where it forked from the main checkout so exit can see its commits;
			// using the worktree's own HEAD here would make every commit look
			// pre-existing and let exit force-delete the branch.
			const mainHead = await resolveCommit(pi, root, "HEAD");
			baseCommit = mainHead ? await mergeBase(pi, target, mainHead) : undefined;
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

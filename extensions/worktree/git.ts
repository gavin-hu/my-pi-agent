/**
 * Git plumbing for the worktree extension.
 *
 * Everything goes through `pi.exec`, so commands run with the same shell
 * configuration (and abort/timeout handling) as the rest of Pi.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WorktreeConfig } from "./config.ts";

interface GitResult {
	stdout: string;
	stderr: string;
	code: number;
}

async function git(pi: ExtensionAPI, args: string[], cwd: string, timeout?: number): Promise<GitResult> {
	const result = await pi.exec("git", args, timeout ? { cwd, timeout } : { cwd });
	return { stdout: result.stdout, stderr: result.stderr, code: result.code };
}

/**
 * Run a network git operation with terminal prompting disabled, so a fetch that
 * would ask for credentials fails fast instead of hanging until its timeout.
 * The environment is restored afterwards.
 */
export async function withGitNoPrompt<T>(fn: () => Promise<T>): Promise<T> {
	const previous = process.env.GIT_TERMINAL_PROMPT;
	process.env.GIT_TERMINAL_PROMPT = "0";
	try {
		return await fn();
	} finally {
		if (previous === undefined) delete process.env.GIT_TERMINAL_PROMPT;
		else process.env.GIT_TERMINAL_PROMPT = previous;
	}
}

/**
 * Canonicalize a path, resolving symlinks. Handles paths that do not exist yet
 * by canonicalizing the nearest existing ancestor, so `/tmp/x` and
 * `/private/tmp/x` compare equal on macOS.
 */
export function canonicalize(path: string): string {
	const absolute = resolve(path);
	try {
		return realpathSync(absolute);
	} catch {
		try {
			return join(realpathSync(dirname(absolute)), basename(absolute));
		} catch {
			return absolute;
		}
	}
}

/** Absolute path of the repository root containing `cwd`, or undefined when not a git repo. */
export async function repoRoot(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
	const result = await git(pi, ["rev-parse", "--show-toplevel"], cwd);
	if (result.code !== 0) return undefined;
	const root = result.stdout.trim();
	return root ? canonicalize(root) : undefined;
}

/** Whether the repository has at least one commit (a worktree needs a commit to branch from). */
export async function hasCommits(pi: ExtensionAPI, repoRoot: string): Promise<boolean> {
	const result = await git(pi, ["rev-parse", "--verify", "--quiet", "HEAD"], repoRoot);
	return result.code === 0 && result.stdout.trim().length > 0;
}

/** The branch currently checked out in a worktree. */
export async function currentBranch(pi: ExtensionAPI, dir: string): Promise<string | undefined> {
	const result = await git(pi, ["rev-parse", "--abbrev-ref", "HEAD"], dir);
	const branch = result.stdout.trim();
	return result.code === 0 && branch && branch !== "HEAD" ? branch : undefined;
}

/**
 * Resolve the base ref to branch a new worktree from.
 *
 * "fresh": prefer the remote default branch (origin/HEAD). Refresh it when the
 * repository was not fetched recently, but never block on input; fall back to
 * whatever is cached, then to local HEAD.
 * "head": use local HEAD of the repository.
 */
export async function resolveBaseRef(
	pi: ExtensionAPI,
	repoRoot: string,
	config: WorktreeConfig,
): Promise<{ ref: string; mode: "fresh" | "head" }> {
	if (config.baseRef === "head") return { ref: "HEAD", mode: "head" };

	const branch = await defaultBranch(pi, repoRoot);
	if (branch) {
		if (config.fetchRemote && (await fetchStale(pi, repoRoot))) {
			// Never block on credentials: treat an error or timeout as "keep using the cache".
			await withGitNoPrompt(() =>
				git(pi, ["fetch", "--no-tags", "origin", branch], repoRoot, config.fetchTimeoutMs),
			);
		}
		const remoteRef = `origin/${branch}`;
		const exists = await git(pi, ["rev-parse", "--verify", "--quiet", remoteRef], repoRoot);
		if (exists.code === 0 && exists.stdout.trim()) return { ref: remoteRef, mode: "fresh" };
	}
	return { ref: "HEAD", mode: "head" };
}

/** The repository's default branch name from `origin/HEAD`, if known. */
export async function defaultBranch(pi: ExtensionAPI, repoRoot: string): Promise<string | undefined> {
	const symbolic = await git(pi, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], repoRoot);
	const branch = symbolic.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
	return branch || undefined;
}

const FETCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Whether the repository has not been fetched in the last 24 hours. */
export async function fetchStale(pi: ExtensionAPI, repoRoot: string, maxAgeMs = FETCH_MAX_AGE_MS): Promise<boolean> {
	const common = await git(pi, ["rev-parse", "--path-format=absolute", "--git-common-dir"], repoRoot);
	if (common.code !== 0) return true;
	const fetchHead = resolve(common.stdout.trim(), "FETCH_HEAD");
	try {
		return Date.now() - statSync(fetchHead).mtimeMs > maxAgeMs;
	} catch {
		return true;
	}
}

/** Hard-reset a worktree to a ref (used when reopening a clean, unused worktree). */
export async function resetHard(pi: ExtensionAPI, dir: string, ref: string): Promise<void> {
	await git(pi, ["reset", "--hard", ref], dir);
}

export interface PrReference {
	number: number;
	host: "github" | "gitlab" | "other";
}

/** Parse `#1234`, a GitHub pull request URL, or a GitLab merge request URL. */
export function parsePrReference(input: string): PrReference | undefined {
	const hash = input.match(/^#(\d+)$/);
	if (hash) return { number: Number.parseInt(hash[1], 10), host: "other" };
	try {
		const url = new URL(input);
		const pull = url.pathname.match(/\/pull\/(\d+)/);
		if (pull) return { number: Number.parseInt(pull[1], 10), host: url.hostname === "github.com" ? "github" : "other" };
		const merge = url.pathname.match(/\/merge_requests\/(\d+)/);
		if (merge) return { number: Number.parseInt(merge[1], 10), host: url.hostname === "gitlab.com" ? "gitlab" : "other" };
	} catch {
		// Not a URL.
	}
	return undefined;
}

/** Fetch a pull/merge request's head commit from origin. Never waits for credentials. */
export async function fetchPrRef(
	pi: ExtensionAPI,
	repoRoot: string,
	pr: PrReference,
	timeoutMs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const specs =
		pr.host === "gitlab"
			? [`merge-requests/${pr.number}/head`]
			: [`pull/${pr.number}/head`, `merge-requests/${pr.number}/head`];
	for (const spec of specs) {
		const result = await withGitNoPrompt(() => git(pi, ["fetch", "--no-tags", "origin", spec], repoRoot, timeoutMs));
		if (result.code === 0) return { ok: true };
	}
	return { ok: false, error: `Failed to fetch PR/MR #${pr.number}` };
}

/** Path of a managed worktree directory from its name. */
export function worktreePath(repoRoot: string, config: WorktreeConfig, name: string): string {
	return canonicalize(resolve(repoRoot, config.dir, name));
}

export async function worktreeExists(pi: ExtensionAPI, dir: string): Promise<boolean> {
	const want = canonicalize(dir);
	const result = await git(pi, ["worktree", "list", "--porcelain"], dir);
	if (result.code !== 0) return false;
	return result.stdout
		.split("\n")
		.some(
			(line) =>
				line.startsWith("worktree ") && canonicalize(line.slice("worktree ".length).trim()) === want,
		);
}

/** Whether a local branch exists. */
export async function branchExists(pi: ExtensionAPI, repoRoot: string, branch: string): Promise<boolean> {
	const result = await git(pi, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repoRoot);
	return result.code === 0;
}

/**
 * Create a worktree. With `createBranch` (default) it adds a new branch from
 * `base`; otherwise it attaches an existing branch and `base` is ignored.
 * Returns an error message on failure.
 */
export async function worktreeAdd(
	pi: ExtensionAPI,
	repoRoot: string,
	dir: string,
	branch: string,
	base: string,
	createBranch = true,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const args = createBranch
		? ["worktree", "add", "-b", branch, dir, base]
		: ["worktree", "add", dir, branch];
	const result = await git(pi, args, repoRoot);
	if (result.code === 0) return { ok: true };
	const detail = (result.stderr || result.stdout).trim();
	return { ok: false, error: detail || `git worktree add exited with code ${result.code}` };
}

export async function worktreeRemove(
	pi: ExtensionAPI,
	repoRoot: string,
	dir: string,
	force: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const args = ["worktree", "remove"];
	if (force) args.push("--force");
	args.push(dir);
	const result = await git(pi, args, repoRoot);
	if (result.code === 0) return { ok: true };
	return { ok: false, error: (result.stderr || result.stdout).trim() || "git worktree remove failed" };
}

export async function deleteBranch(
	pi: ExtensionAPI,
	repoRoot: string,
	branch: string,
	force: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const result = await git(pi, ["branch", force ? "-D" : "-d", branch], repoRoot);
	if (result.code === 0) return { ok: true };
	return { ok: false, error: (result.stderr || result.stdout).trim() || `Could not delete branch ${branch}` };
}

/** Porcelain status lines for a working tree; empty when clean. */
export async function statusEntries(pi: ExtensionAPI, dir: string): Promise<string[]> {
	const result = await git(pi, ["status", "--porcelain"], dir);
	if (result.code !== 0) return [];
	return result.stdout.split("\n").filter((line) => line.trim().length > 0);
}

/** Count of commits reachable from HEAD but not from `base`. */
export async function commitsAhead(pi: ExtensionAPI, dir: string, base: string): Promise<number> {
	const result = await git(pi, ["rev-list", "--count", `${base}..HEAD`], dir);
	if (result.code !== 0) return 0;
	const count = Number.parseInt(result.stdout.trim(), 10);
	return Number.isFinite(count) ? count : 0;
}

/** Merge base of `ref` and HEAD, used as the fork point of a reopened worktree. */
export async function mergeBase(pi: ExtensionAPI, dir: string, ref: string): Promise<string | undefined> {
	const result = await git(pi, ["merge-base", ref, "HEAD"], dir);
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

export type CheckoutCheck =
	| { ok: true }
	| { ok: false; reason: "gone" | "unsafe" | "unverified"; detail: string };

/**
 * Verify a directory is a usable, separate checkout before restoring it.
 * Mirrors Claude Code's refusal checks.
 */
export async function checkCheckout(pi: ExtensionAPI, dir: string, mainRoot: string): Promise<CheckoutCheck> {
	if (!existsSync(dir) || !statSync(dir).isDirectory()) {
		return { ok: false, reason: "gone", detail: `Worktree directory ${dir} no longer exists.` };
	}
	const top = await repoRoot(pi, dir);
	if (!top) {
		return { ok: false, reason: "unsafe", detail: `${dir} is not a git worktree.` };
	}
	if (canonicalize(top) === canonicalize(mainRoot)) {
		return {
			ok: false,
			reason: "unsafe",
			detail: `${dir} resolves its working tree to the main checkout ${mainRoot}.`,
		};
	}
	const commonDir = await git(pi, ["rev-parse", "--path-format=absolute", "--git-common-dir"], dir);
	if (commonDir.code !== 0) {
		return { ok: false, reason: "unverified", detail: `Could not read git metadata for ${dir}.` };
	}
	return { ok: true };
}

/**
 * Inspect submodules recursively for uncommitted work. `known: false` means git
 * could not inspect them, so cleanup should not assume the worktree is clean.
 */
export async function submoduleChanges(
	pi: ExtensionAPI,
	dir: string,
): Promise<{ known: boolean; count: number }> {
	const list = await git(pi, ["submodule", "status", "--recursive"], dir);
	if (list.code !== 0) return { known: false, count: 0 };
	const modules = list.stdout.split("\n").filter((line) => line.trim().length > 0);
	if (modules.length === 0) return { known: true, count: 0 };

	const foreach = await git(
		pi,
		["submodule", "foreach", "--recursive", "--quiet", "git status --porcelain"],
		dir,
	);
	if (foreach.code !== 0) return { known: false, count: 0 };

	const count = foreach.stdout
		.split("\n")
		.filter((line) => line.trim().length > 0 && !line.startsWith("Entering ")).length;
	return { known: true, count };
}

export interface WorkInspection {
	dirty: string[];
	ahead: number;
	sub: { known: boolean; count: number };
	/** Any uncommitted change, commit ahead of `base`, or submodule change. */
	hasWork: boolean;
	/** Submodules could not be inspected, so "clean" is unverified. */
	unverifiable: boolean;
}

/** Inspect a worktree for work relative to `base` (commits reachable from HEAD but not it). */
export async function inspectWork(pi: ExtensionAPI, dir: string, base?: string): Promise<WorkInspection> {
	const dirty = await statusEntries(pi, dir);
	const ahead = base ? await commitsAhead(pi, dir, base) : 0;
	const sub = await submoduleChanges(pi, dir);
	return {
		dirty,
		ahead,
		sub,
		unverifiable: !sub.known,
		hasWork: dirty.length > 0 || ahead > 0 || sub.count > 0,
	};
}

export interface ManagedWorktree {
	path: string;
	branch?: string;
	head?: string;
	/** Lock reason when locked, empty string when locked without one. */
	locked?: string;
}

/** List managed worktrees under the configured directory. */
export async function listManagedWorktrees(
	pi: ExtensionAPI,
	repoRoot: string,
	config: WorktreeConfig,
): Promise<ManagedWorktree[]> {
	const result = await git(pi, ["worktree", "list", "--porcelain"], repoRoot);
	if (result.code !== 0) return [];
	const managedRoot = canonicalize(resolve(repoRoot, config.dir));
	const entries: ManagedWorktree[] = [];
	let current: ManagedWorktree = { path: "" };
	const flush = () => {
		if (!current.path) return;
		const path = canonicalize(current.path);
		if (path === managedRoot || path.startsWith(`${managedRoot}/`) || path.startsWith(`${managedRoot}\\`)) {
			entries.push({ ...current, path });
		}
		current = { path: "" };
	};
	for (const line of result.stdout.split("\n")) {
		if (line.startsWith("worktree ")) {
			flush();
			current.path = line.slice("worktree ".length).trim();
		} else if (line.startsWith("branch ")) {
			current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
		} else if (line.startsWith("HEAD ")) {
			current.head = line.slice("HEAD ".length).trim().slice(0, 8);
		} else if (line === "locked" || line.startsWith("locked ")) {
			current.locked = line === "locked" ? "" : line.slice("locked ".length).trim();
		} else if (line.trim() === "") {
			flush();
		}
	}
	flush();
	return entries;
}

/** Lock a worktree so a concurrent sweep does not remove it. */
export async function lockWorktree(pi: ExtensionAPI, repoRoot: string, dir: string, reason: string): Promise<boolean> {
	const result = await git(pi, ["worktree", "lock", "--reason", reason, dir], repoRoot);
	return result.code === 0;
}

/** Release a lock we hold. Failure is ignored (it may already be unlocked). */
export async function unlockWorktree(pi: ExtensionAPI, repoRoot: string, dir: string): Promise<void> {
	await git(pi, ["worktree", "unlock", dir], repoRoot);
}

/** Whether a process id is alive on this host. */
export function isProcessAlive(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Read-only git queries.
 *
 * Small helpers that ask git *about* the repository rather than changing it.
 * They run through an injected {@link RunGit}, so they are testable without a
 * runtime. Keeping them here means worktree, rewind, plan, and board share one
 * definition instead of re-implementing `rev-parse` or a log search.
 */

import { realpathSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExecRunner, runGitOrThrow, type RunGit } from "./runner.ts";

/** Absolute repository root containing `cwd`, or undefined when not a git repo. */
export async function repoRoot(runGit: RunGit, cwd: string): Promise<string | undefined> {
	const result = await runGit(["rev-parse", "--show-toplevel"], { cwd });
	if (result.code !== 0) return undefined;
	const root = result.stdout.trim();
	if (!root) return undefined;
	// git prints forward slashes on Windows even for `--show-toplevel`, so resolve
	// to the native real path: it then compares equal to fs paths and to a
	// snapshot root recorded elsewhere. Fall back to git's string when the path
	// is not resolvable (for example a fake runner in a unit test).
	try {
		return realpathSync.native(root);
	} catch {
		return root;
	}
}

/**
 * Repository root via a Pi `exec`, optionally capping each git call with
 * `timeoutMs`. Never throws: a failed or stuck git call yields `undefined`.
 */
export async function repoRootFor(
	pi: Pick<ExtensionAPI, "exec">,
	cwd: string,
	timeoutMs?: number,
): Promise<string | undefined> {
	const run = createExecRunner(pi);
	const runGit: RunGit = timeoutMs === undefined ? run : (args, options) => run(args, { timeoutMs, ...options });
	try {
		return await repoRoot(runGit, cwd);
	} catch {
		return undefined;
	}
}

/** The commit `cwd` is on, or undefined outside a repository and on a failed call. */
export async function headSha(runGit: RunGit, cwd: string): Promise<string | undefined> {
	const result = await runGit(["rev-parse", "HEAD"], { cwd });
	if (result.code !== 0) return undefined;
	return result.stdout.trim() || undefined;
}

/**
 * One commit on `ref`'s first-parent chain: what it is, when it was committed, and its parents.
 *
 * `at` is the committer's moment in milliseconds, the unit every card stamp uses — `git` speaks
 * seconds, and a comparison across the two units is a comparison of two unrelated numbers.
 */
export interface ChainCommit {
	sha: string;
	/** The committer's moment, in milliseconds. */
	at: number;
	parents: string[];
}

/**
 * The commits on `ref`'s first-parent chain, oldest first, with each one's parents.
 *
 * The walk follows the first parent only, which is the line a landing sits on: a merge's second
 * parent is the branch it carried, so anything found down that line is the work rather than the
 * history it was merged into. Oldest first is the caller's contract — the board stops at the first
 * merge that proves a review, and `git rev-list`'s own order is not that promise under a
 * criss-cross.
 *
 * The moment comes from the same call rather than a second one per commit: a landing has to know
 * whether a merge committed before the card's work began, and `%ct` is the cheapest way to ask.
 *
 * A failed read answers `[]`, the same as a repository with no commits: a caller that cannot tell
 * the two apart wants {@link firstParentChainOrThrow}, which says which one it met.
 */
export async function firstParentChain(runGit: RunGit, cwd: string, ref: string): Promise<ChainCommit[]> {
	const result = await runGit(chainArgs(ref), { cwd });
	if (result.code !== 0) return [];
	return parseChain(result.stdout);
}

/**
 * The same chain, but a read that failed throws with git's own words.
 *
 * The board's landing proof is the caller, and it needs the difference: `[]` from a successful read
 * is a repository with nothing to land, while `[]` from a failed one is a close nobody can resolve
 * — and a refusal that names neither the command nor git's message leaves a reader guessing. A
 * `code` that is not `0` covers the rarer shape too: a seam handing back no number at all compares
 * unequal to zero and would otherwise read as an empty history.
 */
export async function firstParentChainOrThrow(runGit: RunGit, cwd: string, ref: string): Promise<ChainCommit[]> {
	return parseChain(await runGitOrThrow(runGit, chainArgs(ref), { cwd }));
}

/** The log call both chain doors make: the format is the parser's, not a caller's. */
function chainArgs(ref: string): string[] {
	return ["log", "--first-parent", "--reverse", "--format=%H %ct %P", ref];
}

/** One line per commit, as the chain's `--format` writes it. */
function parseChain(stdout: string): ChainCommit[] {
	const chain: ChainCommit[] = [];
	for (const line of stdout.split("\n")) {
		const [sha, seconds, ...parents] = line.trim().split(/\s+/).filter(Boolean);
		const at = Number(seconds) * 1_000;
		if (sha !== undefined && Number.isFinite(at)) chain.push({ sha, at, parents });
	}
	return chain;
}

/**
 * Whether a merge carried `sha`: on its branch side, and not already on the line it was made on.
 *
 * Both halves are needed, and `parents` is the commit's own list in git's order. The first parent is
 * the line the merge landed on, so a commit reachable from it was already main's — a sign taken on
 * the base a branch was cut from is exactly that, and answering "carried" for it is what let a close
 * name a merge that carried nothing. So `sha` must be reachable from a *carried* parent (the second
 * and any later) and **not** from the first. A plain commit has no carried side, and carries nothing.
 *
 * `undefined` is a read that failed, and its caller refuses the close rather than guessing a
 * landing; a real `false` is the answer `git` gave.
 */
export async function carriedBy(
	runGit: RunGit,
	cwd: string,
	parents: readonly string[],
	sha: string,
): Promise<boolean | undefined> {
	const [first, ...carried] = parents;
	if (first === undefined) return false;
	const reaches = async (from: string): Promise<boolean | undefined> => {
		const result = await runGit(["merge-base", "--is-ancestor", sha, from], { cwd });
		if (result.code === 0) return true;
		return result.code === 1 ? false : undefined;
	};
	// Read the first parent first: a commit on the line the merge was made on is not this merge's work,
	// whatever the branch side says.
	const onLine = await reaches(first);
	if (onLine === undefined) return undefined;
	if (onLine) return false;
	let unknown = false;
	for (const parent of carried) {
		const found = await reaches(parent);
		if (found === true) return true;
		if (found === undefined) unknown = true;
	}
	return unknown ? undefined : false;
}

/**
 * The best common ancestor of two revisions: the point where their lines parted.
 *
 * Undefined is also a read that failed, and its one caller treats "cannot tell" as a reason to
 * refuse a close rather than to wave one through. Named `forkPoint` rather than git's verb because
 * the question here is the fork, not the merge: `worktree`'s own `mergeBase` asks a ref against HEAD.
 */
async function forkPoint(runGit: RunGit, cwd: string, a: string, b: string): Promise<string | undefined> {
	const result = await runGit(["merge-base", a, b], { cwd });
	if (result.code !== 0) return undefined;
	return result.stdout.trim() || undefined;
}

/**
 * The reviewed files a merge rewrote: the work `reviewed` did since its fork, compared line by
 * line with what `merged` carried of that work.
 *
 * A clean `--no-ff` answers nothing, whatever landed on the branch in the meantime: the merge
 * carries `reviewed` whole, so the branch's own change — read against the merge's **first
 * parent**, which is the line the merge landed on — reproduces the review's change of every file.
 * A neighbour's file is not the review's, and a neighbour's edit in a file the review also
 * touched is not the review's change either: that is why the comparison is of changed lines
 * rather than of file names. What is left is a file whose lines the merger wrote itself — the
 * tree nobody ran the gate on.
 *
 * Whitespace is not ignored: a reindent is a changed line and refuses, which is the conservative
 * direction — a false refusal costs a signature, a false accept costs the gate.
 *
 * One case cannot be told apart and is accepted: a resolution that reproduces the review's own
 * lines exactly is the tree that was reviewed for those lines.
 *
 * `undefined` is a read that failed, not "nothing moved": the caller refuses a close it could
 * not check rather than accepting one on a missing diff.
 *
 * The fork is read against the merge's **first parent**, not the merge: a merge already carries
 * `reviewed`, so `merge-base(reviewed, merged)` is `reviewed` itself and would compare the review
 * with nothing.
 */
export async function resolvedByMerge(
	runGit: RunGit,
	cwd: string,
	reviewed: string,
	merged: string,
): Promise<string[] | undefined> {
	const first = `${merged}^1`;
	const base = await forkPoint(runGit, cwd, reviewed, first);
	if (base === undefined) return undefined;
	const own = await changedLines(runGit, cwd, base, reviewed);
	const landed = await changedLines(runGit, cwd, first, merged);
	if (own === undefined || landed === undefined) return undefined;
	const moved: string[] = [];
	for (const [path, lines] of own) {
		// A file the merge did not carry at all is a change the merger dropped, so it moved too.
		const carried = landed.get(path);
		if (carried === undefined || carried.length !== lines.length) {
			moved.push(path);
			continue;
		}
		if (carried.some((line, at) => line !== lines[at])) moved.push(path);
	}
	return moved.sort();
}

/**
 * The lines a diff changed, per file: what a merge has to reproduce to count as that change.
 *
 * `-U0` keeps context out, so two diffs of the same change compare equal wherever the lines sit.
 * A mode change is a changed line of its own; the headers that describe the diff are not.
 */
async function changedLines(
	runGit: RunGit,
	cwd: string,
	from: string,
	to: string,
): Promise<Map<string, string[]> | undefined> {
	// The unquoted spelling, so a file name is one name: `core.quotePath` would hand back `"a/x"`.
	const result = await runGit(["-c", "core.quotePath=false", "diff", "-U0", "--no-color", from, to], { cwd });
	if (result.code !== 0) return undefined;
	const changed = new Map<string, string[]>();
	let path: string | undefined;
	for (const line of result.stdout.split("\n")) {
		if (line.startsWith("diff --git a/")) {
			// One path, twice, for an edit; a rename reads as a delete and an add, which refuses.
			path = line.slice("diff --git a/".length).split(" b/")[0];
			changed.set(path, []);
			continue;
		}
		if (path === undefined) continue;
		if (/^(new file mode|deleted file mode|old mode|new mode)/.test(line)) changed.get(path)?.push(line);
		else if (line.startsWith("+") || line.startsWith("-")) changed.get(path)?.push(line);
	}
	return changed;
}

/** Absolute path of the repository's git directory. */
export async function gitDir(runGit: RunGit, cwd: string): Promise<string | undefined> {
	const result = await runGit(["rev-parse", "--absolute-git-dir"], { cwd });
	if (result.code !== 0) return undefined;
	const dir = result.stdout.trim();
	return dir || undefined;
}

/** Absolute path of the repository's common git directory, shared by its worktrees. */
export async function gitCommonDir(runGit: RunGit, cwd: string): Promise<string | undefined> {
	const result = await runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
	if (result.code !== 0) return undefined;
	const dir = result.stdout.trim();
	return dir || undefined;
}

/** Resolve a revision to a full object id, or undefined when it does not exist. */
export async function revParse(runGit: RunGit, cwd: string, rev: string): Promise<string | undefined> {
	const result = await runGit(["rev-parse", "--verify", "--quiet", rev], { cwd });
	if (result.code !== 0) return undefined;
	const id = result.stdout.trim();
	return id || undefined;
}

/**
 * Resolve several revisions in one `git rev-parse`, in the order given.
 *
 * A snapshot needs `HEAD` and its tree, and two calls pay two spawns for one
 * answer; `rev-parse` prints one line per argument, so one call is enough. A
 * revision that does not resolve is not a shorter list — it is no answer, since
 * the caller's indices would shift — so the result is `[]` unless every one
 * resolved.
 */
export async function revParseMany(runGit: RunGit, cwd: string, revs: readonly string[]): Promise<string[]> {
	if (revs.length === 0) return [];
	const result = await runGit(["rev-parse", ...revs], { cwd });
	if (result.code !== 0) return [];
	const ids = result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	return ids.length === revs.length ? ids : [];
}

/**
 * A working tree of the repository, as `git worktree list --porcelain` reports it.
 */
export interface WorktreeEntry {
	/** The path git prints for the working tree. */
	path: string;
	/** The commit checked out there, shortened the way the worktree screen draws it. */
	head?: string;
	/** The branch checked out there, without `refs/heads/`. */
	branch?: string;
	/** Whether the entry is the bare repository rather than a checkout. */
	bare?: boolean;
	/** The lock reason, or the empty string for a lock without one. */
	locked?: string;
}

/** Characters of a commit id kept here: every caller compares or draws one short. */
const SHORT_ID = 8;

/**
 * Every working tree of the repository containing `cwd`, the main checkout first.
 *
 * That order is git's promise, and callers lean on it: the first entry is the
 * repository's own directory, which is the name a session works under rather than
 * the worktree it happens to sit in. The format is parsed here once — the worktree
 * extension filters this list, the bus reads it — so a field git adds is one edit.
 * A failed call is no list, the same answer as a repository git will not describe.
 */
export async function worktrees(runGit: RunGit, cwd: string): Promise<WorktreeEntry[]> {
	const result = await runGit(["worktree", "list", "--porcelain"], { cwd });
	if (result.code !== 0) return [];
	const entries: WorktreeEntry[] = [];
	let current: WorktreeEntry | undefined;
	const flush = () => {
		if (current) entries.push(current);
		current = undefined;
	};
	for (const line of result.stdout.split("\n")) {
		if (line.startsWith("worktree ")) {
			flush();
			current = { path: line.slice("worktree ".length).trim() };
			continue;
		}
		// A line before the first entry describes no tree, so it belongs to none.
		if (!current) continue;
		if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length).trim().slice(0, SHORT_ID);
		else if (line.startsWith("branch "))
			current.branch = line
				.slice("branch ".length)
				.trim()
				.replace(/^refs\/heads\//, "");
		else if (line === "bare") current.bare = true;
		else if (line === "locked" || line.startsWith("locked "))
			current.locked = line === "locked" ? "" : line.slice("locked ".length).trim();
		else if (line.trim() === "") flush();
	}
	flush();
	return entries;
}

/** Whether the repository has at least one commit. */
export async function hasCommits(runGit: RunGit, cwd: string): Promise<boolean> {
	return (await revParse(runGit, cwd, "HEAD")) !== undefined;
}

/** Branch checked out at `cwd`, or undefined when HEAD is detached. */
export async function currentBranch(runGit: RunGit, cwd: string): Promise<string | undefined> {
	const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
	if (result.code !== 0) return undefined;
	const branch = result.stdout.trim();
	return branch && branch !== "HEAD" ? branch : undefined;
}

export interface DefaultBranchOptions {
	/**
	 * Fall back to a local `main`/`master` when no remote names a default. Off by default: the
	 * worktree extension asks for the remote's branch only, while a landing may read the local line.
	 */
	fallback?: boolean;
}

/**
 * The branch this repository lands on: `origin/HEAD` when a remote names one; with `fallback`, the
 * local `main` or `master` when it does not.
 *
 * The landing line is the default branch's, not the branch a checkout happens to have. A peer
 * branch left in the shared checkout, or a worktree's own branch, must not move it.
 */
export async function defaultBranch(
	runGit: RunGit,
	cwd: string,
	options: DefaultBranchOptions = {},
): Promise<string | undefined> {
	const remote = await runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd });
	if (remote.code === 0) {
		const name = remote.stdout.trim().replace(/^origin\//, "");
		if (name !== "") return name;
	}
	if (options.fallback !== true) return undefined;
	for (const name of ["main", "master"]) {
		const local = await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], { cwd });
		if (local.code === 0) return name;
	}
	return undefined;
}

/**
 * Read-only git context for the browse pages.
 *
 * The header shows the checked-out branch (or the detached head) and a dirty
 * marker. Queries go through the shared `lib/git` seams so the read-only
 * plumbing lives in one place. State (the TTL cache) lives in the factory
 * closure, never in `lib/`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExecRunner, currentBranch, hasCommits, repoRoot, revParse, type RunGit } from "../../lib/git/index.ts";
import {
	diffArgs,
	inMode,
	parseStatusZ,
	parseUnifiedDiff,
	type ChangedFile,
	type DiffLine,
	type DiffMode,
} from "./diff.ts";
import { readFileView } from "./files.ts";

export interface GitStatus {
	/** Checked-out branch, when HEAD is attached. */
	branch?: string;
	/** Short object id, when HEAD is detached. */
	head?: string;
	/** True when `git status --porcelain` reports any change. */
	dirty: boolean;
}

export type GitStatusProvider = () => Promise<GitStatus | undefined>;

export interface GitStatusOptions {
	/** How long a result is reused, in ms (default 2000). */
	ttlMs?: number;
	/** Wall-clock seam; defaults to the real clock. */
	now?: () => number;
}

/**
 * Build a provider for `root` that caches its result for `ttlMs`. It never
 * throws: a non-repository, a failed git call, or a timeout yields `undefined`,
 * and the page simply omits the chip.
 */
export function createGitStatus(
	pi: Pick<ExtensionAPI, "exec">,
	root: string,
	options: GitStatusOptions = {},
): GitStatusProvider {
	const runGit = createExecRunner(pi);
	const ttlMs = options.ttlMs ?? 2000;
	const now = options.now ?? (() => Date.now());
	let cached: GitStatus | undefined;
	let checkedAt = 0;
	let pending: Promise<GitStatus | undefined> | undefined;

	async function read(run: RunGit): Promise<GitStatus | undefined> {
		if (!(await repoRoot(run, root))) return undefined;
		const branch = await currentBranch(run, root);
		const head = branch ? undefined : (await revParse(run, root, "HEAD"))?.slice(0, 7);
		if (!branch && !head) return undefined;
		const status = await run(["status", "--porcelain"], { cwd: root, timeoutMs: 1000 });
		if (status.code !== 0) return undefined;
		return { branch, head, dirty: status.stdout.trim().length > 0 };
	}

	return async () => {
		if (pending) return pending;
		const t = now();
		if (checkedAt !== 0 && t - checkedAt < ttlMs) return cached;
		checkedAt = t;
		pending = read(runGit)
			.catch(() => undefined)
			.then((status) => {
				cached = status;
				return status;
			})
			.finally(() => {
				pending = undefined;
			});
		return pending;
	};
}

/** One comparison scope's change list. */
export interface DiffList {
	mode: DiffMode;
	files: ChangedFile[];
	/** `git diff --stat` output for the scope, or an empty string. */
	stat: string;
}

/** A single file's diff for a scope. */
export interface DiffFileView {
	mode: DiffMode;
	rel: string;
	lines: DiffLine[];
	/** True for a binary or unreadable change; `lines` is then empty. */
	binary: boolean;
	truncated: boolean;
}

/**
 * Change list and per-file diffs for the browse pages. Like
 * {@link createGitStatus}, it never throws: a non-repository, a failed git
 * call, or a timeout yields `undefined`, and the page omits the diff UI.
 */
export interface GitDiffProvider {
	list(mode: DiffMode): Promise<DiffList | undefined>;
	file(rel: string, mode: DiffMode): Promise<DiffFileView | undefined>;
}

export interface GitDiffOptions {
	/** How long the status list is reused, in ms (default 2000). */
	ttlMs?: number;
	/** Unified context lines (default 3). */
	context?: number;
	/** Rendered diff lines before truncation (default 4000). */
	maxLines?: number;
	/** Per-call git timeout in ms (default 4000). */
	timeoutMs?: number;
	/** Max bytes read for an untracked file's all-add diff (default 1 MiB). */
	maxFileBytes?: number;
	/** Max lines read for an untracked file's all-add diff (default 5000). */
	maxTextLines?: number;
	/** Wall-clock seam; defaults to the real clock. */
	now?: () => number;
}

interface RepoState {
	files: ChangedFile[];
	hasCommits: boolean;
}

/** Build a read-only diff provider for `root`, with a TTL-cached status list. */
export function createGitDiff(
	pi: Pick<ExtensionAPI, "exec">,
	root: string,
	options: GitDiffOptions = {},
): GitDiffProvider {
	const exec = createExecRunner(pi);
	const run: RunGit = (args, opts) => exec(args, { timeoutMs: options.timeoutMs ?? 4000, ...opts });
	const ttlMs = options.ttlMs ?? 2000;
	const context = Math.max(0, options.context ?? 3);
	const maxLines = Math.max(1, options.maxLines ?? 4000);
	const maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
	const maxTextLines = options.maxTextLines ?? 5000;
	const now = options.now ?? (() => Date.now());

	let cached: RepoState | undefined;
	let checkedAt = 0;
	let pending: Promise<RepoState | undefined> | undefined;

	async function read(): Promise<RepoState | undefined> {
		if (!(await repoRoot(run, root))) return undefined;
		const status = await run(["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: root });
		if (status.code !== 0) return undefined;
		return { files: parseStatusZ(status.stdout), hasCommits: await hasCommits(run, root) };
	}

	/** The cached repository state, or `undefined` outside a repository. */
	function state(): Promise<RepoState | undefined> {
		if (pending) return pending;
		const t = now();
		if (checkedAt !== 0 && t - checkedAt < ttlMs) return Promise.resolve(cached);
		checkedAt = t;
		pending = read()
			.catch(() => undefined)
			.then((next) => {
				cached = next;
				return next;
			})
			.finally(() => {
				pending = undefined;
			});
		return pending;
	}

	/** `head` needs a commit; before the first one, compare the index instead. */
	const effectiveMode = (mode: DiffMode, has: boolean): DiffMode => (mode === "head" && !has ? "staged" : mode);

	/** An untracked file as an all-add diff, read through the shared file view. */
	async function untracked(rel: string, mode: DiffMode): Promise<DiffFileView> {
		try {
			const view = await readFileView(root, rel, maxFileBytes, maxTextLines);
			if (view.kind === "text" || view.kind === "markdown") {
				// Drop the empty element a trailing newline produces, so the added
				// lines match the count git shows for the same file.
				const last = view.lines.length - 1;
				const source = last >= 0 && view.lines[last] === "" ? view.lines.slice(0, last) : view.lines;
				return {
					mode,
					rel,
					lines: source.map((text, index) => ({ kind: "add" as const, text, newNo: index + 1 })),
					binary: false,
					truncated: view.truncated,
				};
			}
			return { mode, rel, lines: [], binary: true, truncated: false };
		} catch {
			return { mode, rel, lines: [], binary: false, truncated: false };
		}
	}

	return {
		async list(mode) {
			const current = await state();
			if (!current) return undefined;
			const stat = await run(
				["diff", "--no-color", "--stat", ...diffArgs(effectiveMode(mode, current.hasCommits)), "--"],
				{ cwd: root },
			);
			return {
				mode,
				files: current.files.filter((file) => inMode(file, mode)),
				stat: stat.code === 0 ? stat.stdout.trim() : "",
			};
		},
		async file(rel, mode) {
			const current = await state();
			if (!current) return undefined;
			if (current.files.some((file) => file.rel === rel && file.untracked)) return untracked(rel, mode);
			const result = await run(
				["diff", "--no-color", `-U${context}`, "-M", ...diffArgs(effectiveMode(mode, current.hasCommits)), "--", rel],
				{ cwd: root, env: { GIT_LITERAL_PATHSPECS: "1" } },
			);
			if (result.code !== 0) return undefined;
			return { mode, rel, ...parseUnifiedDiff(result.stdout, maxLines) };
		},
	};
}

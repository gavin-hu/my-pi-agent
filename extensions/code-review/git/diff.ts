/**
 * The review's snapshot: what git says a scope changes, read once per page.
 *
 * `file-browse` reads a scope the page asks for on every request; a review needs
 * the same list plus one fingerprint of it, because a write names the snapshot it
 * rendered and a mismatch is refused. Everything here is read-only and never
 * throws: a non-repository, a missing base, or a failed git call answers with the
 * sentence the page prints.
 *
 * Pure data over `RunGit`, so a case drives a temp repository and the page's own
 * suite drives a stub.
 */

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type DiffLine, parseUnifiedDiff } from "../../../lib/diff/parse.ts";
import type { DiffSide } from "../../../lib/diff/modes.ts";
import {
	createExecRunner,
	defaultBranch,
	hasCommits,
	literalPathspec,
	repoRoot,
	revParse,
	type RunGit,
} from "../../../lib/git/index.ts";
import { mapConcurrent } from "../../../lib/pool.ts";
import { comparesNothing, MAX_BASE_LENGTH, NO_COMPARISON, type ReviewScope, scopeLabel, wireSide } from "../scope.ts";

/** The header git prints for a combined diff, which has three columns and no two sides. */
const COMBINED_DIFF = /^diff --cc /m;

/** What `git diff --cached` prints instead of a diff for a path with conflicts. */
const UNMERGED_PATH = "* Unmerged path ";

/** One changed file in a snapshot. */
export interface ReviewFile {
	/** Root-relative, posix-style path. */
	rel: string;
	/** The one status letter the rail draws: `M`, `A`, `D`, `R`, `?`. */
	status: string;
	/** Added lines in the diff shown. */
	add: number;
	/** Removed lines in the diff shown. */
	del: number;
	/** The parsed diff, capped at `maxLines`. */
	lines: DiffLine[];
	/** A binary change, which has no text diff. */
	binary: boolean;
	/**
	 * True when the file is unmerged in this comparison, so git answered with a combined diff or
	 * with `* Unmerged path` rather than two sides: there are no rows to draw and the page says so.
	 */
	unmerged?: boolean;
	/** True when `maxLines` cut the diff short. */
	truncated: boolean;
}

/** One scope read at one moment. */
export interface ReviewSnapshot {
	scope: ReviewScope;
	/** What the page names the comparison by, e.g. `origin/main...HEAD` or `index → working tree`. */
	label: string;
	/** The short sha of the left end, when it names a revision; display only. */
	fromSha?: string;
	/** The short sha of the right end, when it names a revision; display only. */
	toSha?: string;
	files: ReviewFile[];
	/** Changed files the cap left out. */
	omitted: number;
	insertions: number;
	deletions: number;
	/** What a write names to prove it rendered this exact diff. */
	fingerprint: string;
}

/** A snapshot, or the sentence that says why there is none. */
export type SnapshotOutcome = { kind: "snapshot"; snapshot: ReviewSnapshot } | { kind: "failed"; message: string };

/** A whole file as context lines, or the sentence that says why it has no text to show. */
export type TextOutcome =
	| {
			kind: "text";
			lines: DiffLine[];
			binary: boolean;
			truncated: boolean;
			/** The file's whole line count, or nothing when `maxFileBytes` cut the read. */
			totalLines?: number;
	  }
	| { kind: "failed"; message: string };

/**
 * The ref a `base` review compares against, or the sentence naming why there is none.
 *
 * The fault is part of the answer because the three faults owe different sentences: a
 * repository with no default branch has a key to set, and a configured ref that does not
 * resolve has one to correct.
 */
export type BaseOutcome = { kind: "ref"; ref: string } | { kind: "failed"; message: string };

/** The reader a page holds for one root. */
export interface ReviewReader {
	/** The ref a `base` review compares against, or the sentence naming the fault. */
	baseRef(): Promise<BaseOutcome>;
	/** One path's whole text as context lines — both gutter numbers the same — capped by
	 * `maxFileBytes` and `maxLines`. The file view's reader, and no second one.
	 */
	text(rel: string): Promise<TextOutcome>;
	/** Read one comparison, resolving whichever sides name git state. */
	snapshot(scope: ReviewScope): Promise<SnapshotOutcome>;
}

export interface ReviewReaderOptions {
	/** The configured base ref, before detection. */
	base?: string;
	/** Unified context lines; default 3. */
	context?: number;
	/** Rendered diff lines per file; default 4 000. */
	maxLines?: number;
	/** Changed files read; default 200. */
	maxFiles?: number;
	/** Bytes read from an untracked file; default 1 MiB. */
	maxFileBytes?: number;
	/** Per-call git timeout in ms; default 4 000. */
	timeoutMs?: number;
	/** Per-call read width; default 6. */
	width?: number;
}

/** Sentences a scope with no answer prints. */
export const NOT_A_REPOSITORY = "the working directory is not a git repository";
export const NO_COMMITS = "this repository has no commits yet";
export const NO_PARENT = "HEAD has no parent commit to review";
export const NO_BASE = 'no base branch found — set "base" in the bytefly.json code-review section';
export const NO_TEXT = "that file could not be read — it may have been deleted";

/** The sentence a configured ref that does not resolve owes, so the key is not blamed for nothing. */
export function baseUnresolved(ref: string): string {
	return `the code-review base "${ref}" does not resolve — check that key in bytefly.json`;
}

/** The sentence one side of a comparison owes when git cannot read it. */
export function noSuchSide(ref: string): string {
	return `the comparison names "${ref}", which this repository does not have`;
}

/** The sentence two revisions owe when their histories share no ancestor to compare from. */
export function noCommonAncestor(from: string, to: string): string {
	return `"${from}" and "${to}" share no commit to compare from`;
}

/** The sentence a configured ref past the bound owes; it names the length, not 200 characters of ref. */
export function baseTooLong(length: number): string {
	return `the code-review base is ${length} characters; the longest accepted is ${MAX_BASE_LENGTH}`;
}

/**
 * A file's lines under a byte cap, with the two facts a view owes: whether the bytes are
 * binary, and whether the cap cut it short. `undefined` when the file cannot be read — a
 * review lists paths git printed, and one of them may be gone.
 */
async function readTextFile(
	abs: string,
	cap: number,
): Promise<{ lines: string[]; binary: boolean; truncated: boolean; totalLines?: number } | undefined> {
	let buffer: Buffer;
	let cut = false;
	try {
		const handle = await open(abs, "r");
		try {
			const info = await handle.stat();
			const size = Math.min(info.size, cap);
			cut = info.size > size;
			buffer = Buffer.alloc(size);
			await handle.read(buffer, 0, size, 0);
		} finally {
			await handle.close();
		}
	} catch {
		return undefined;
	}
	const text = buffer.toString("utf8");
	if (text.includes("\0")) return { lines: [], binary: true, truncated: false };
	const lines = text.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	// A read the byte cap cut knows how much it showed and not how much there is, so the total
	// is absent rather than a partial count read as the whole file.
	return { lines, binary: false, truncated: cut, ...(cut ? {} : { totalLines: lines.length }) };
}

/** A reader over an injected git seam: what a suite drives. */
export function createReviewReaderFrom(run: RunGit, root: string, options: ReviewReaderOptions = {}): ReviewReader {
	const configured = options.base ?? "";
	const context = Math.max(0, options.context ?? 3);
	const maxLines = Math.max(1, options.maxLines ?? 4000);
	const maxFiles = Math.max(1, options.maxFiles ?? 200);
	const maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
	const width = Math.max(1, options.width ?? 6);

	/**
	 * The branch a `base` review compares against: the configured ref, else the repository's
	 * default branch, read through its `origin/` ref when that resolves.
	 *
	 * The chain is `lib/git`'s, and only the chain is: which line a change lands on is a
	 * different question from which line a branch is cut from, so the `origin/` preference
	 * and the three fault sentences live here rather than in `defaultBranch`.
	 */
	async function baseRef(): Promise<BaseOutcome> {
		if (configured !== "") {
			// A configured ref never falls through to detection: a typo would otherwise review
			// against the default branch and nobody would learn the key is wrong.
			if (configured.length > MAX_BASE_LENGTH) return { kind: "failed", message: baseTooLong(configured.length) };
			if (await revParse(run, root, configured)) return { kind: "ref", ref: configured };
			return { kind: "failed", message: baseUnresolved(configured) };
		}
		const name = await defaultBranch(run, root, { fallback: true });
		if (name !== undefined) {
			// The shared chain names a branch, not a ref that resolves: `origin/HEAD` can point at
			// a deleted remote branch, and a base that does not resolve is a diff git refuses.
			const tracked = `origin/${name}`;
			if (await revParse(run, root, tracked)) return { kind: "ref", ref: tracked };
			if (await revParse(run, root, name)) return { kind: "ref", ref: name };
		}
		return { kind: "failed", message: NO_BASE };
	}

	return {
		baseRef,
		async text(rel) {
			const read = await readTextFile(join(root, rel), maxFileBytes);
			if (read === undefined) return { kind: "failed", message: NO_TEXT };
			if (read.binary) return { kind: "text", lines: [], binary: true, truncated: false };
			const truncated = read.truncated || read.lines.length > maxLines;
			const lines: DiffLine[] = read.lines
				.slice(0, maxLines)
				.map((body, index) => ({ kind: "ctx", text: body, oldNo: index + 1, newNo: index + 1 }));
			return {
				kind: "text",
				lines,
				binary: false,
				truncated,
				...(read.totalLines === undefined ? {} : { totalLines: read.totalLines }),
			};
		},
		async snapshot(scope) {
			const repo = await repoRoot(run, root);
			if (!repo) return { kind: "failed", message: NOT_A_REPOSITORY };
			if (comparesNothing(scope)) return { kind: "failed", message: NO_COMPARISON };
			// A commit is needed only where a side names one: an unborn branch still has an index
			// and a working tree, and `HEAD` there reads as the empty tree git compares them with.
			const commits = await hasCommits(run, repo);
			const from = await sideSha(repo, scope.from, commits, scope.to.kind === "index");
			if ("message" in from) return { kind: "failed", message: from.message };
			const to = await sideSha(repo, scope.to, commits, false);
			if ("message" in to) return { kind: "failed", message: to.message };
			let left = from.sha;
			// Two commits compare from the line they share, so a branch that merged its base in
			// still reads as the branch's own change — the answer `A...B` gives, computed once.
			if (left !== undefined && to.sha !== undefined) {
				const shared = await run(["merge-base", left, to.sha], { cwd: repo });
				const merged = shared.code === 0 ? shared.stdout.trim() : "";
				if (merged === "")
					return { kind: "failed", message: noCommonAncestor(wireSide(scope.from), wireSide(scope.to)) };
				left = merged;
			}
			// The argv for a side is `lib/diff`'s, loaded where it is used: a start pays nothing for a
			// fact only a read needs.
			const { sideArgs } = await import("../../../lib/diff/modes.ts");
			const args = sideArgs(left, scope.to);
			const listing = await listFiles(repo, args, scope.to.kind === "tree");
			if (listing.kind === "failed") return listing;
			const shown = listing.files.slice(0, maxFiles);
			const omitted = Math.max(0, listing.files.length - shown.length);
			const files = await mapConcurrent(shown, width, (entry) => readFile(repo, entry, args));
			const label = scopeLabel(scope);
			const hash = createHash("sha256");
			hash.update(`${sideKey(scope.from)}\0${sideKey(scope.to)}\0${label}\0`);
			for (const file of files) {
				hash.update(`${file.rel}\0${file.status}\0`);
				for (const line of file.lines)
					hash.update(`${line.kind}\0${line.oldNo ?? ""}\0${line.newNo ?? ""}\0${line.text}\n`);
			}
			const insertions = files.reduce((total, file) => total + file.add, 0);
			const deletions = files.reduce((total, file) => total + file.del, 0);
			const fingerprint = hash.digest("hex").slice(0, 16);
			// The shas are display-only and never enter the digest: a sha in the hash would move the
			// fingerprint between builds of one tree, and every open page would refuse its own write.
			return {
				kind: "snapshot",
				snapshot: {
					scope,
					label,
					...(from.sha === undefined ? {} : { fromSha: from.sha.slice(0, 7) }),
					...(to.sha === undefined ? {} : { toSha: to.sha.slice(0, 7) }),
					files,
					omitted,
					insertions,
					deletions,
					fingerprint,
				},
			};
		},
	};

	/** One entry in the change list, before its diff is read. */
	interface Listed {
		rel: string;
		status: string;
		untracked: boolean;
	}

	/**
	 * One side as git reads it: the commit it names, or nothing when it names no commit.
	 *
	 * `HEAD` on a branch with no commits yet names the empty tree, which is what
	 * `git diff --cached` already compares the index against — so `staged` renders there.
	 * Any other place a missing `HEAD` would land is the fault it looks like, because git has
	 * no one expression for "the tree against nothing" that would not spell a magic hash.
	 */
	async function sideSha(
		repo: string,
		side: DiffSide,
		commits: boolean,
		emptyTree: boolean,
	): Promise<{ sha?: string } | { message: string }> {
		if (side.kind !== "rev") return {};
		const sha = await revParse(run, repo, side.ref);
		if (sha !== undefined) return { sha };
		if (!commits && side.ref === "HEAD" && emptyTree) return {};
		if (!commits) return { message: NO_COMMITS };
		return { message: /^HEAD[~^]/.test(side.ref) ? NO_PARENT : noSuchSide(side.ref) };
	}

	/**
	 * The files a scope changes, listed by the same pair its per-file diffs are read with, so
	 * the list and the diff cannot disagree; untracked files join when the right side is the
	 * working tree, and only then.
	 */
	async function listFiles(
		repo: string,
		args: readonly string[],
		untracked: boolean,
	): Promise<{ kind: "list"; files: Listed[] } | { kind: "failed"; message: string }> {
		const nameStatus = await run(["diff", "--no-color", "--name-status", "-z", "-M", ...args, "--"], {
			cwd: repo,
		});
		if (nameStatus.code !== 0) return { kind: "failed", message: "git diff could not read this comparison" };
		const files = parseNameStatusZ(nameStatus.stdout).map((file) => ({ ...file, untracked: false }));
		if (!untracked) return { kind: "list", files };
		const others = await run(["ls-files", "--others", "--exclude-standard", "-z"], { cwd: repo });
		if (others.code !== 0) return { kind: "failed", message: "git ls-files could not read this tree" };
		const fresh = others.stdout
			.split("\0")
			.filter((rel) => rel !== "")
			.map((rel) => ({ rel, status: "?", untracked: true }));
		return { kind: "list", files: [...files, ...fresh] };
	}

	/** One listed file's diff: an untracked file's all-add body, or git's own. */
	async function readFile(repo: string, entry: Listed, args: readonly string[]): Promise<ReviewFile> {
		if (entry.untracked) return untrackedFile(repo, entry.rel, entry.status);
		const diff = await run(["diff", "--no-color", `-U${context}`, "-M", ...args, "--", literalPathspec(entry.rel)], {
			cwd: repo,
		});
		if (diff.code !== 0) {
			return { rel: entry.rel, status: entry.status, add: 0, del: 0, lines: [], binary: false, truncated: false };
		}
		// An unmerged path has no two sides to compare: `worktree` gets a combined `diff --cc` with
		// three columns, `staged` gets the `* Unmerged path` line alone. Neither is a diff this page
		// can draw, and parsing either would only produce rows with no line numbers.
		if (COMBINED_DIFF.test(diff.stdout) || diff.stdout.startsWith(UNMERGED_PATH))
			return {
				rel: entry.rel,
				status: entry.status,
				add: 0,
				del: 0,
				lines: [],
				binary: false,
				unmerged: true,
				truncated: false,
			};
		const parsed = parseUnifiedDiff(diff.stdout, maxLines);
		return {
			rel: entry.rel,
			status: entry.status,
			...tally(parsed.lines),
			lines: parsed.lines,
			binary: parsed.binary,
			truncated: parsed.truncated,
		};
	}

	/** An untracked file as an all-add diff, read up to the byte cap. */
	async function untrackedFile(repo: string, rel: string, status: string): Promise<ReviewFile> {
		const empty: ReviewFile = { rel, status, add: 0, del: 0, lines: [], binary: false, truncated: false };
		const read = await readTextFile(join(repo, rel), maxFileBytes);
		if (read === undefined) return empty;
		if (read.binary) return { ...empty, binary: true };
		const truncated = read.truncated || read.lines.length > maxLines;
		const lines: DiffLine[] = read.lines
			.slice(0, maxLines)
			.map((body, index) => ({ kind: "add", text: body, newNo: index + 1 }));
		return { rel, status, add: lines.length, del: 0, lines, binary: false, truncated };
	}
}

/** A side as the fingerprint keys it, so two comparisons with one diff are still two scopes. */
function sideKey(side: DiffSide): string {
	return side.kind === "rev" ? `rev:${side.ref}` : side.kind;
}

/** Add and remove counts over the lines shown. */
function tally(lines: readonly DiffLine[]): { add: number; del: number } {
	let add = 0;
	let del = 0;
	for (const line of lines) {
		if (line.kind === "add") add += 1;
		else if (line.kind === "del") del += 1;
	}
	return { add, del };
}

/** `git diff --name-status -z -M`: one status letter per path, a rename's two paths after `R`. */
export function parseNameStatusZ(stdout: string): Array<{ rel: string; status: string }> {
	const tokens = stdout.split("\0");
	const files: Array<{ rel: string; status: string }> = [];
	for (let index = 0; index < tokens.length; ) {
		const head = tokens[index++];
		if (!head) break;
		const status = head[0] ?? "M";
		if (status === "R" || status === "C") {
			index += 1;
			const to = tokens[index++] ?? "";
			if (to) files.push({ rel: to, status });
		} else {
			const rel = tokens[index++] ?? "";
			if (rel) files.push({ rel, status });
		}
	}
	return files;
}

/** The reader a page holds: the host's `exec` behind the shared seam. */
export function createReviewReader(
	pi: Pick<ExtensionAPI, "exec">,
	root: string,
	options: ReviewReaderOptions = {},
): ReviewReader {
	const exec = createExecRunner(pi);
	const timeoutMs = options.timeoutMs ?? 4000;
	const run: RunGit = (args, callOptions) => exec(args, { timeoutMs, ...callOptions });
	return createReviewReaderFrom(run, root, options);
}

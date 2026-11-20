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
import { inMode, parseStatusZ, statusLetter } from "../../../lib/diff/status.ts";
import { createExecRunner, hasCommits, repoRoot, revParse, type RunGit } from "../../../lib/git/index.ts";
import { mapConcurrent } from "../../../lib/pool.ts";
import { type ReviewScope, scopeArgs } from "../scope.ts";

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
	/** True when `maxLines` cut the diff short. */
	truncated: boolean;
}

/** One scope read at one moment. */
export interface ReviewSnapshot {
	scope: ReviewScope;
	/** The resolved base ref for `base`; `""` for the other scopes. */
	base: string;
	/** What the header names the comparison by, e.g. `origin/main...HEAD`. */
	label: string;
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

/** The reader a page holds for one root. */
export interface ReviewReader {
	/** The ref a `base` review compares against, or undefined when none resolves. */
	baseRef(): Promise<string | undefined>;
	/** Read a scope with `base` (the effective ref) or the configured one. */
	snapshot(scope: ReviewScope, base?: string): Promise<SnapshotOutcome>;
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

/** A reader over an injected git seam: what a suite drives. */
export function createReviewReaderFrom(run: RunGit, root: string, options: ReviewReaderOptions = {}): ReviewReader {
	const configured = options.base ?? "";
	const context = Math.max(0, options.context ?? 3);
	const maxLines = Math.max(1, options.maxLines ?? 4000);
	const maxFiles = Math.max(1, options.maxFiles ?? 200);
	const maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
	const width = Math.max(1, options.width ?? 6);

	/** The branch a `base` review lands on: configured, then origin/HEAD, then main/master. */
	async function baseRef(): Promise<string | undefined> {
		if (configured) return (await revParse(run, root, configured)) ? configured : undefined;
		const remote = await run(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd: root });
		if (remote.code === 0) {
			const ref = remote.stdout.trim();
			if (ref && (await revParse(run, root, ref))) return ref;
		}
		for (const ref of ["main", "master", "origin/main", "origin/master"]) {
			if (await revParse(run, root, ref)) return ref;
		}
		return undefined;
	}

	return {
		baseRef,
		async snapshot(scope, effectiveBase) {
			const repo = await repoRoot(run, root);
			if (!repo) return { kind: "failed", message: NOT_A_REPOSITORY };
			if (!(await hasCommits(run, repo))) return { kind: "failed", message: NO_COMMITS };
			if (scope === "last" && !(await revParse(run, repo, "HEAD~1"))) {
				return { kind: "failed", message: NO_PARENT };
			}
			let base = "";
			if (scope === "base") {
				base = effectiveBase ?? (await baseRef()) ?? "";
				if (!base) return { kind: "failed", message: NO_BASE };
			}
			const planned = scopeArgs(scope, base);
			const listing = await listFiles(repo, scope, planned.args, planned.untracked);
			if (listing.kind === "failed") return listing;
			const shown = listing.files.slice(0, maxFiles);
			const omitted = Math.max(0, listing.files.length - shown.length);
			const files = await mapConcurrent(shown, width, (entry) => readFile(repo, entry, planned.args));
			const hash = createHash("sha256");
			hash.update(`${scope}\0${base}\0${planned.label}\0`);
			for (const file of files) {
				hash.update(`${file.rel}\0${file.status}\0`);
				for (const line of file.lines)
					hash.update(`${line.kind}\0${line.oldNo ?? ""}\0${line.newNo ?? ""}\0${line.text}\n`);
			}
			const insertions = files.reduce((total, file) => total + file.add, 0);
			const deletions = files.reduce((total, file) => total + file.del, 0);
			return {
				kind: "snapshot",
				snapshot: {
					scope,
					base,
					label: planned.label,
					files,
					omitted,
					insertions,
					deletions,
					fingerprint: hash.digest("hex").slice(0, 16),
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

	/** The files a scope changes, or the sentence a failed git call owes. */
	async function listFiles(
		repo: string,
		scope: ReviewScope,
		args: readonly string[],
		untracked: boolean,
	): Promise<{ kind: "list"; files: Listed[] } | { kind: "failed"; message: string }> {
		if (scope === "staged" || scope === "worktree" || scope === "head") {
			const status = await run(["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: repo });
			if (status.code !== 0) return { kind: "failed", message: "git status could not read this tree" };
			const files = parseStatusZ(status.stdout)
				.filter((file) => inMode(file, scope))
				.map((file) => ({ rel: file.rel, status: statusLetter(file), untracked: file.untracked && untracked }));
			return { kind: "list", files };
		}
		const nameStatus = await run(["diff", "--no-color", "--name-status", "-z", "-M", ...args, "--"], {
			cwd: repo,
		});
		if (nameStatus.code !== 0) return { kind: "failed", message: "git diff could not read this range" };
		return { kind: "list", files: parseNameStatusZ(nameStatus.stdout).map((file) => ({ ...file, untracked: false })) };
	}

	/** One listed file's diff: an untracked file's all-add body, or git's own. */
	async function readFile(repo: string, entry: Listed, args: readonly string[]): Promise<ReviewFile> {
		if (entry.untracked) return untrackedFile(repo, entry.rel, entry.status);
		const diff = await run(["diff", "--no-color", `-U${context}`, "-M", ...args, "--", entry.rel], {
			cwd: repo,
			env: { GIT_LITERAL_PATHSPECS: "1" },
		});
		if (diff.code !== 0) {
			return { rel: entry.rel, status: entry.status, add: 0, del: 0, lines: [], binary: false, truncated: false };
		}
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
		let buffer: Buffer;
		let cut = false;
		try {
			const handle = await open(join(repo, rel), "r");
			try {
				const info = await handle.stat();
				const size = Math.min(info.size, maxFileBytes);
				cut = info.size > size;
				buffer = Buffer.alloc(size);
				await handle.read(buffer, 0, size, 0);
			} finally {
				await handle.close();
			}
		} catch {
			return empty;
		}
		const text = buffer.toString("utf8");
		if (text.includes("\0")) return { ...empty, binary: true };
		const parts = text.split("\n");
		if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
		const truncated = cut || parts.length > maxLines;
		const shown = parts.slice(0, maxLines);
		const lines: DiffLine[] = shown.map((body, index) => ({ kind: "add", text: body, newNo: index + 1 }));
		return { rel, status, add: lines.length, del: 0, lines, binary: false, truncated };
	}
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

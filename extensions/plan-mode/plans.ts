/**
 * Plan-file storage for plan mode.
 *
 * A plan is written to disk as markdown, one immutable file per submitted plan,
 * so the user can read the same artifact the model is working from and the plan
 * survives outside the conversation. Files live under `<repo-root>/.pi/plans`
 * (the worktree root inside a worktree), or under `<agent-dir>/plans` outside a
 * repository.
 *
 * The directory is self-ignoring: the first write drops a `.gitignore` with `*`
 * so plans never show up as untracked files or inside rewind snapshots,
 * without editing the project's own `.gitignore`.
 *
 * This module owns paths and bytes only; tool wiring lives in `tools.ts`.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { extractPlanSteps } from "./steps.ts";

/** Largest plan accepted, in UTF-8 bytes. */
export const MAX_PLAN_BYTES = 256 * 1024;
/** Longest slug derived from a plan title. */
const MAX_SLUG_LENGTH = 60;

/** A plan read from disk. */
export interface StoredPlan {
	/** Absolute path. */
	path: string;
	/** Path relative to the working directory, when it is inside it. */
	relativePath: string;
	content: string;
	bytes: number;
}

/** A plan written to disk, carrying the title that named it. */
export interface WrittenPlan extends StoredPlan {
	title: string;
}

/** One entry in the plans directory, enough to render a list row. */
export interface PlanSummary {
	/** Absolute path. */
	path: string;
	/** Path relative to the working directory, when it is inside it. */
	relativePath: string;
	/** File name minus `.md` and the timestamp prefix. */
	title: string;
	bytes: number;
	/** Modification time in milliseconds, for newest-first ordering. */
	modified: number;
	/** Top-level steps `extractPlanSteps` finds in the file. */
	steps: number;
}

export interface WritePlanInput {
	/** Short title; drives the file-name slug. */
	title: string;
	/** Full plan as markdown. */
	content: string;
	/** Existing file to overwrite (a refinement) instead of creating a new one. */
	planPath?: string;
}

export interface PlanStore {
	/** Directory plans are written to for `cwd`. */
	dirFor(cwd: string): Promise<string>;
	write(cwd: string, input: WritePlanInput): Promise<WrittenPlan>;
	/** Read a plan inside the plans directory, or undefined when missing/outside. */
	read(cwd: string, planPath: string): Promise<StoredPlan | undefined>;
	/** Every plan in the plans directory, newest first. */
	list(cwd: string): Promise<PlanSummary[]>;
	/** Delete a plan inside the plans directory; false when missing or outside. */
	remove(cwd: string, planPath: string): Promise<boolean>;
}

/** Timestamp prefix the plan store adds to file names. */
const PLAN_STAMP = /^\d{4}-\d{2}-\d{2}-\d{4}-/;

/** Human title for a plan file name: drop the extension and the timestamp prefix. */
export function planTitle(fileName: string): string {
	return fileName.replace(/\.md$/i, "").replace(PLAN_STAMP, "") || fileName;
}

/** Turn a title into a filename-safe slug. */
export function slugify(title: string): string {
	const slug = title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+/, "")
		.slice(0, MAX_SLUG_LENGTH)
		.replace(/-+$/, "");
	return slug || "plan";
}

/** Local `YYYY-MM-DD-HHmm` stamp. */
export function stamp(date: Date): string {
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Whether `path` resolves strictly inside `dir`. */
export function isWithin(dir: string, path: string): boolean {
	const rel = relative(resolve(dir), resolve(path));
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** A plan file name: markdown and not a dotfile, so the self-ignore file is never a target. */
function isPlanFileName(path: string): boolean {
	const name = basename(path);
	return name.toLowerCase().endsWith(".md") && !name.startsWith(".");
}

/**
 * Whether `path` may be read, written, or deleted as a plan. Beyond the lexical
 * containment in {@link isWithin}, this rejects dotfiles (including the
 * directory's own `.gitignore`) and resolves symlinks, so a link placed inside
 * the plans directory cannot redirect a read or write outside it.
 */
function isContainedPlan(dir: string, path: string): boolean {
	if (!isWithin(dir, path) || !isPlanFileName(path)) return false;
	try {
		// A symlink itself must never be the target; a missing file is a new plan.
		if (lstatSync(path).isSymbolicLink()) return false;
	} catch {
		// Missing (ENOENT) is expected; any other error falls through to the
		// real-path check, which rejects the path if it cannot be resolved.
	}
	try {
		const realDir = realpathSync(dir);
		const realParent = realpathSync(dirname(path));
		return realParent === realDir || isWithin(realDir, realParent);
	} catch {
		return false;
	}
}

/** Keep plan files out of git (and so out of rewind snapshots) without touching the project. */
function ensureIgnored(dir: string): void {
	const ignore = join(dir, ".gitignore");
	if (existsSync(ignore)) return;
	try {
		writeFileSync(ignore, "*\n", "utf-8");
	} catch {
		// A read-only plans directory will fail on the plan write anyway; the
		// ignore file is best-effort.
	}
}

/** `path` relative to `cwd` when inside it, else `path`. */
function relativeTo(cwd: string, path: string): string {
	const rel = relative(cwd, path);
	return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
}

function uniquePath(dir: string, base: string): string {
	const taken = (candidate: string): boolean => {
		try {
			// lstat, not exists: a dangling symlink still occupies the name and must
			// never be written through.
			lstatSync(candidate);
			return true;
		} catch {
			return false;
		}
	};
	let candidate = join(dir, `${base}.md`);
	let suffix = 2;
	while (taken(candidate)) {
		candidate = join(dir, `${base}-${suffix}.md`);
		suffix += 1;
	}
	return candidate;
}

/** Repository (or worktree) root of `cwd`, or undefined outside a repository. */
async function repoRoot(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
	try {
		const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5_000 });
		const root = result.code === 0 ? result.stdout.trim() : "";
		return root || undefined;
	} catch {
		return undefined;
	}
}

export function createPlanStore(pi: ExtensionAPI, options: { now?: () => Date } = {}): PlanStore {
	const now = options.now ?? (() => new Date());
	// One `git rev-parse` per working directory; a worktree switch is a new cwd.
	const dirCache = new Map<string, string>();

	const dirFor = async (cwd: string): Promise<string> => {
		const cached = dirCache.get(cwd);
		if (cached) return cached;
		const root = await repoRoot(pi, cwd);
		const dir = root ? join(root, CONFIG_DIR_NAME, "plans") : join(getAgentDir(), "plans");
		dirCache.set(cwd, dir);
		return dir;
	};

	const write = async (cwd: string, input: WritePlanInput): Promise<WrittenPlan> => {
		const title = input.title.trim();
		if (!title) throw new Error("A plan title is required.");
		const bytes = Buffer.byteLength(input.content, "utf-8");
		if (bytes > MAX_PLAN_BYTES) {
			throw new Error(`The plan is too large (${bytes} bytes; the limit is ${MAX_PLAN_BYTES}).`);
		}

		const dir = await dirFor(cwd);
		mkdirSync(dir, { recursive: true });
		ensureIgnored(dir);

		let path: string;
		if (input.planPath) {
			const resolved = resolve(cwd, input.planPath);
			if (!isContainedPlan(dir, resolved)) {
				throw new Error("plan_path must be a markdown plan file inside the plans directory.");
			}
			path = resolved;
		} else {
			path = uniquePath(dir, `${stamp(now())}-${slugify(title)}`);
		}

		// A new plan can still land on a dangling symlink; refuse to write through it.
		if (!isContainedPlan(dir, path)) {
			throw new Error("The plan path is not writable inside the plans directory.");
		}

		writeFileSync(path, input.content, "utf-8");
		return { path, relativePath: relativeTo(cwd, path), title, content: input.content, bytes };
	};

	const read = async (cwd: string, planPath: string): Promise<StoredPlan | undefined> => {
		const dir = await dirFor(cwd);
		const resolved = resolve(cwd, planPath);
		if (!isContainedPlan(dir, resolved) || !existsSync(resolved)) return undefined;
		try {
			const content = readFileSync(resolved, "utf-8");
			return { path: resolved, relativePath: relativeTo(cwd, resolved), content, bytes: Buffer.byteLength(content, "utf-8") };
		} catch {
			return undefined;
		}
	};

	const list = async (cwd: string): Promise<PlanSummary[]> => {
		const dir = await dirFor(cwd);
		if (!existsSync(dir)) return [];

		let entries: string[];
		try {
			entries = readdirSync(dir, { withFileTypes: true })
				.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
				.map((entry) => entry.name);
		} catch {
			return [];
		}

		const summaries: PlanSummary[] = [];
		for (const name of entries) {
			const path = join(dir, name);
			try {
				const stats = statSync(path);
				const content = readFileSync(path, "utf-8");
				summaries.push({
					path,
					relativePath: relativeTo(cwd, path),
					title: planTitle(name),
					bytes: stats.size,
					modified: stats.mtimeMs,
					steps: extractPlanSteps(content).length,
				});
			} catch {
				// A file that vanished or cannot be read is skipped, not fatal to the list.
			}
		}

		// Newest first; the path breaks ties so the order is stable across identical mtimes.
		summaries.sort((a, b) => b.modified - a.modified || b.path.localeCompare(a.path));
		return summaries;
	};

	const remove = async (cwd: string, planPath: string): Promise<boolean> => {
		const dir = await dirFor(cwd);
		const resolved = resolve(cwd, planPath);
		if (!isContainedPlan(dir, resolved) || !existsSync(resolved)) return false;
		try {
			unlinkSync(resolved);
			return true;
		} catch {
			return false;
		}
	};

	return { dirFor, write, read, list, remove };
}

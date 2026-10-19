/**
 * Plan-file storage for plan mode.
 *
 * A plan is written to disk as markdown: one file per plan, named from the
 * title and stamp. A refinement rewrites that file atomically, so the user can
 * read the same artifact the model is working from and the plan survives
 * outside the conversation without a partial write ever being visible. Files
 * live under `<repo-root>/.pi/plans` (the worktree root inside a worktree), or
 * under `<agent-dir>/plans` outside a repository.
 *
 * The directory is self-ignoring: the first write drops a `.gitignore` with `*`
 * so plans never show up as untracked files or inside rewind snapshots,
 * without editing the project's own `.gitignore`.
 *
 * This module owns paths and bytes only; tool wiring lives in `tools.ts`.
 */

import { randomBytes } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { repoRootFor } from "../../lib/git/index.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { isInside, isInsideReal } from "../../lib/path.ts";
import { formatFeedback, type PlanAnnotation } from "./feedback.ts";
import { extractPlanSteps, matchesStepText, setStepStatuses, type StepUpdate } from "./steps.ts";

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

/** One row of the plan index: enough to choose a plan without opening it. */
export interface PlanSummary {
	/** Absolute path. */
	path: string;
	/** Path relative to the working directory, when it is inside it. */
	relativePath: string;
	/** The plan's `# title`, or a title derived from the file name. */
	title: string;
	/** File modification time, ms since the epoch. */
	modified: number;
	bytes: number;
	/** Steps done and total, or undefined for a file the store would not have written. */
	steps?: { done: number; total: number };
	/** True when the file is over {@link MAX_PLAN_BYTES} and was listed without a read. */
	oversize?: boolean;
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
	/** The newest plan file in the plans directory, or undefined when there is none. */
	latest(cwd: string): Promise<StoredPlan | undefined>;
	/**
	 * Every plan in the directory, newest first. The directory is the index, so
	 * this is one `readdir`, one `stat` per file, and one bounded read per plan.
	 */
	index(cwd: string): Promise<PlanSummary[]>;
	/** Set the given top-level steps' checkboxes in an existing plan. Throws when the file or any step is invalid. */
	setSteps(cwd: string, planPath: string, updates: StepUpdate[]): Promise<StoredPlan>;
	/** Replace the plan's stored browser feedback. Throws when the file is missing or outside the plans directory. */
	saveFeedback(cwd: string, planPath: string, annotations: PlanAnnotation[]): Promise<StoredPlan>;
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

/** A plan file name: markdown and not a dotfile, so the self-ignore file is never a target. */
function isPlanFileName(path: string): boolean {
	const name = basename(path);
	return name.toLowerCase().endsWith(".md") && !name.startsWith(".");
}

/**
 * Whether `path` may be read, written, or deleted as a plan. Beyond lexical
 * containment (shared with the other path guards through `lib/path.ts`), this
 * rejects dotfiles (including the directory's own `.gitignore`) and resolves
 * symlinks, so a link placed inside the plans directory cannot redirect a read
 * or write outside it.
 */
function isContainedPlan(dir: string, path: string): boolean {
	if (!isInside(dir, path) || !isPlanFileName(path)) return false;
	try {
		// A symlink itself must never be the target; a missing file is a new plan.
		if (lstatSync(path).isSymbolicLink()) return false;
	} catch {
		// Missing (ENOENT) is expected; any other error falls through to the
		// real-path check, which rejects the path if it cannot be resolved.
	}
	return isInsideReal(dir, dirname(path));
}

/** Keep plan files out of git (and so out of rewind snapshots) without touching the project. */
function ensureIgnored(dir: string): void {
	const ignore = join(dir, ".gitignore");
	try {
		// `wx` is race-free: an existing ignore file (ours or a user's) is left alone.
		writeFileSync(ignore, "*\n", { encoding: "utf-8", flag: "wx" });
	} catch {
		// A read-only plans directory will fail on the plan write anyway; the
		// ignore file is best-effort.
	}
}

/**
 * Write a plan atomically: a hidden sibling temp file, then a rename. A crash
 * or a full disk mid-write leaves the previous file intact instead of a
 * truncated plan, and the temp name is a dotfile, so neither `latest()` nor a
 * plan lookup ever mistakes it for a plan.
 */
function writeAtomic(path: string, content: string): void {
	const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
	try {
		writeFileSync(temp, content, { encoding: "utf-8", flag: "wx" });
		renameSync(temp, path);
	} catch (error) {
		try {
			unlinkSync(temp);
		} catch {
			// The temp file was never created, or the rename already moved it.
		}
		throw error;
	}
}

/** `path` relative to `cwd` when inside it, else `path`. */
function relativeTo(cwd: string, path: string): string {
	const rel = relative(cwd, path);
	return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? rel : path;
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
	// Local `rev-parse` is fast; cap it so a stuck call cannot hang the tool.
	return repoRootFor(pi, cwd, 5_000);
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

		writeAtomic(path, input.content);
		return { path, relativePath: relativeTo(cwd, path), title, content: input.content, bytes };
	};

	const read = async (cwd: string, planPath: string): Promise<StoredPlan | undefined> => {
		const dir = await dirFor(cwd);
		const resolved = resolve(cwd, planPath);
		if (!isContainedPlan(dir, resolved) || !existsSync(resolved)) return undefined;
		try {
			const content = readFileSync(resolved, "utf-8");
			return {
				path: resolved,
				relativePath: relativeTo(cwd, resolved),
				content,
				bytes: Buffer.byteLength(content, "utf-8"),
			};
		} catch {
			return undefined;
		}
	};

	const setSteps = async (cwd: string, planPath: string, updates: StepUpdate[]): Promise<StoredPlan> => {
		const plan = await read(cwd, planPath);
		if (!plan) throw new Error("No plan file there; pass a plan_path written by write_plan.");
		const steps = extractPlanSteps(plan.content);
		const total = steps.length;
		const outOfRange = updates.find(
			(update) => !Number.isInteger(update.step) || update.step < 1 || update.step > total,
		);
		if (outOfRange) {
			const range = total === 0 ? "it has no steps" : `valid steps are 1 to ${total}`;
			throw new Error(`Step ${outOfRange.step} is out of range; ${range}.`);
		}
		// A caller-supplied text is the guard against a reordered plan: refuse the
		// whole batch rather than tick the step that moved into that number.
		const stale = updates.find((update) => {
			if (update.expected === undefined) return false;
			const step = steps[update.step - 1];
			return step === undefined || !matchesStepText(step.content, update.expected);
		});
		if (stale) {
			const actual = steps[stale.step - 1]?.content;
			throw new Error(
				`Step ${stale.step} is no longer "${stale.expected}"; the file now has "${actual ?? "no step"}". Re-read the plan and pass the current step number.`,
			);
		}
		const updated = setStepStatuses(plan.content, updates);
		if (!updated) throw new Error("Could not update the plan steps; pass steps from the plan file.");
		writeAtomic(plan.path, updated);
		return {
			path: plan.path,
			relativePath: plan.relativePath,
			content: updated,
			bytes: Buffer.byteLength(updated, "utf-8"),
		};
	};

	/**
	 * Write the browser review comments into an existing plan, replacing any
	 * feedback already stored there. The file must already be a contained plan,
	 * so this is the same path-safe write as `setSteps`.
	 */
	const saveFeedback = async (cwd: string, planPath: string, annotations: PlanAnnotation[]): Promise<StoredPlan> => {
		const plan = await read(cwd, planPath);
		if (!plan) throw new Error("No plan file there; pass a plan_path written by write_plan.");
		const content = formatFeedback(plan.content, annotations);
		writeAtomic(plan.path, content);
		return {
			path: plan.path,
			relativePath: plan.relativePath,
			content,
			bytes: Buffer.byteLength(content, "utf-8"),
		};
	};

	/**
	 * The newest plan file in the plans directory, for a bare `/plan review` in a
	 * later session. Markdown non-dotfiles only, symlinks skipped like every other
	 * read, newest mtime first with the name (which carries the stamp) as the tie
	 * break.
	 */
	const latest = async (cwd: string): Promise<StoredPlan | undefined> => {
		const dir = await dirFor(cwd);
		let names: string[];
		try {
			names = readdirSync(dir);
		} catch {
			return undefined;
		}
		let newest: { path: string; mtime: number } | undefined;
		for (const name of names) {
			const path = join(dir, name);
			if (!isPlanFileName(path)) continue;
			try {
				// lstat, not stat: a symlink is never a reviewable plan.
				const stat = lstatSync(path);
				if (!stat.isFile()) continue;
				if (!newest || stat.mtimeMs > newest.mtime || (stat.mtimeMs === newest.mtime && path > newest.path)) {
					newest = { path, mtime: stat.mtimeMs };
				}
			} catch {
				// A vanished entry is not a candidate.
			}
		}
		return newest ? read(cwd, newest.path) : undefined;
	};

	/**
	 * Every plan in the directory, newest first: the directory is the index.
	 *
	 * One `readdir`, one `lstat`/`stat` per entry, and one `readFileSync` per plan
	 * that fits {@link MAX_PLAN_BYTES}. A larger file is listed as `oversize`
	 * without being read — the store would never have written it, and pulling it
	 * into memory to print one row is not worth the risk. A symlinked entry, a
	 * dotfile, or a file that vanishes mid-walk is simply not a plan.
	 */
	const index = async (cwd: string): Promise<PlanSummary[]> => {
		const dir = await dirFor(cwd);
		let names: string[];
		try {
			names = readdirSync(dir);
		} catch {
			return [];
		}

		const summaries: PlanSummary[] = [];
		for (const name of names) {
			const path = join(dir, name);
			if (!isPlanFileName(path)) continue;
			let info: ReturnType<typeof statSync>;
			try {
				// lstat, not stat: a symlink is never a plan.
				info = lstatSync(path);
			} catch {
				continue;
			}
			if (!info.isFile()) continue;
			if (!isContainedPlan(dir, path)) continue;

			const summary: PlanSummary = {
				path,
				relativePath: relativeTo(cwd, path),
				title: planTitle(name),
				modified: info.mtimeMs,
				bytes: info.size,
			};
			if (info.size > MAX_PLAN_BYTES) {
				summaries.push({ ...summary, oversize: true });
				continue;
			}
			try {
				const content = readFileSync(path, "utf-8");
				const heading = /^ {0,3}#\s+(.+)$/m.exec(content)?.[1];
				const title = heading === undefined ? "" : sanitizeLine(heading).trim();
				const steps = extractPlanSteps(content);
				summaries.push({
					...summary,
					...(title ? { title } : {}),
					steps: { done: steps.filter((step) => step.status === "completed").length, total: steps.length },
				});
			} catch {
				// An unreadable plan is still a file the user may want to see; list the
				// row from its name and leave the content-derived fields out.
				summaries.push(summary);
			}
		}
		// Newest first, with the name (which carries the stamp) as the tie break —
		// the same order `latest` picks from.
		summaries.sort((a, b) => b.modified - a.modified || (a.path < b.path ? 1 : a.path > b.path ? -1 : 0));
		return summaries;
	};

	return { dirFor, write, read, latest, index, setSteps, saveFeedback };
}

/**
 * Plan-file storage for plan mode.
 *
 * A plan is written to disk as markdown: one file per plan, named from the
 * title and stamp. A refinement rewrites that file atomically, so the user can
 * read the same artifact the model is working from and the plan survives
 * outside the conversation without a partial write ever being visible.
 *
 * Plans live under `<agent-dir>/plans/<repo-key>`, keyed by the repository's
 * common git directory, so every worktree and every session of one repository
 * reads one store — a plan approved in a worktree is the same plan from the main
 * checkout. Outside a repository they land under `<agent-dir>/plans`. An
 * extension tool sees the session cwd rather than the worktree the user entered,
 * so the active worktree is applied before any path is resolved.
 *
 * Plans are outside the project, so they are never untracked files and never
 * appear in a rewind snapshot. A store written by an older version, under
 * `<repo>/.pi/plans`, is moved in once, and nothing is deleted before its plans
 * have arrived.
 *
 * This module owns paths and bytes only; tool wiring lives in `tools.ts`.
 */

import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { keepRevision, writeAtomic } from "./plan-files.ts";
import { sanitizeLine, shortenPath } from "../../lib/format.ts";
import { isInside, isInsideReal } from "../../lib/path.ts";
import { repoKeyFor } from "../../lib/repo-key.ts";
import { carryFeedback, formatFeedback, normalizeAuthor, type PlanAnnotation } from "./feedback.ts";
import { extractPlanSteps, matchesStepText, setStepStatuses, type StepUpdate } from "./steps.ts";

/** Largest plan accepted, in UTF-8 bytes. */
export const MAX_PLAN_BYTES = 256 * 1024;
/** Longest slug derived from a plan title. */
const MAX_SLUG_LENGTH = 60;
/** The agent-directory entry plans are filed under. */
const PLANS_DIRNAME = "plans";

/** The plan store: `<agent-dir>/plans`, or `<agent-dir>/plans/<key>` inside a repository. */
function plansDir(agentDir: string, key?: string): string {
	return key === undefined ? join(agentDir, PLANS_DIRNAME) : join(agentDir, PLANS_DIRNAME, key);
}

/** A plan read from disk. */
export interface StoredPlan {
	/** Absolute path. */
	path: string;
	/** How the path is shown to the user: `~`-shortened, since plans live outside the project. */
	relativePath: string;
	content: string;
	bytes: number;
}

/** A plan written to disk, carrying the title that named it. */
export interface WrittenPlan extends StoredPlan {
	title: string;
	/**
	 * The revision this write replaced, when it refined an existing plan: the text as the
	 * reviewer last read it, kept beside the plan.
	 */
	replaced?: { path: string; relativePath: string };
}

/** One row of the plan index: enough to choose a plan without opening it. */
export interface PlanSummary {
	/** Absolute path. */
	path: string;
	/** How the path is shown to the user: `~`-shortened, since plans live outside the project. */
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
	/** Replace the comments of `options.author` (the owner when absent) and keep every other writer's. */
	saveFeedback(
		cwd: string,
		planPath: string,
		annotations: PlanAnnotation[],
		options?: { author?: string },
	): Promise<StoredPlan>;
	/**
	 * The line a one-time migration wants reported, or undefined.
	 *
	 * A moved store is the user's business — plans are not where they used to be —
	 * so the first caller that can show a notice takes it and clears it.
	 */
	takeNotice(): string | undefined;
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

/**
 * Resolve a `plan_path` argument against the store.
 *
 * A plan lives outside the project, so a path relative to the working directory
 * can no longer name one. Absolute paths and the `~/…` form the tools display are
 * accepted, and a bare name resolves inside the store — which is what a reader of
 * a tool result has in hand.
 */
function resolvePlanArg(dir: string, planPath: string): string {
	const text = planPath.trim();
	if (text === "~") return homedir();
	if (text.startsWith("~/") || text.startsWith(`~${sep}`)) return resolve(homedir(), text.slice(2));
	return isAbsolute(text) ? resolve(text) : resolve(dir, text);
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

/** A repository (or worktree) root is applied before any path here is resolved. */

/** How many legacy plans one migration moves, so a pathological directory cannot stall a tool call. */
const MAX_MIGRATED_PLANS = 200;

/**
 * Move a store written by an older version, under `<repo>/.pi/plans`, into `dir`.
 *
 * Copy-then-unlink when a rename crosses a filesystem boundary, so a store on a
 * different volume still arrives. Nothing here deletes before its plan has
 * landed, a file that cannot move is left where it is, and the old directory
 * goes only when what remains is the ignore file this package used to write.
 */
function migrateLegacyStore(dir: string, legacy: string): number {
	if (!existsSync(legacy)) return 0;
	let names: string[];
	try {
		names = readdirSync(legacy);
	} catch {
		return 0;
	}
	const plans = names.filter((name) => isPlanFileName(name)).slice(0, MAX_MIGRATED_PLANS);
	let moved = 0;
	for (const name of plans) {
		const from = join(legacy, name);
		try {
			if (!statSync(from).isFile()) continue;
			mkdirSync(dir, { recursive: true });
			const to = uniquePath(dir, name.replace(/\.md$/i, ""));
			try {
				renameSync(from, to);
			} catch {
				writeFileSync(to, readFileSync(from), { flag: "wx" });
				unlinkSync(from);
			}
			moved += 1;
		} catch {
			// A plan that cannot move stays where it is, and the directory stays with it.
		}
	}
	try {
		if (readdirSync(legacy).every((name) => name === ".gitignore")) {
			const ignore = join(legacy, ".gitignore");
			if (existsSync(ignore) && readFileSync(ignore, "utf-8") === "*\n") unlinkSync(ignore);
			rmdirSync(legacy);
		}
	} catch {
		// Leave a directory that still holds something.
	}
	return moved;
}

export function createPlanStore(pi: ExtensionAPI, options: { now?: () => Date } = {}): PlanStore {
	const now = options.now ?? (() => new Date());
	// One `git rev-parse` per effective root; a worktree switch changes that root.
	const dirCache = new Map<string, { dir: string; root: string | undefined }>();
	let notice: string | undefined;

	const takeNotice = (): string | undefined => {
		const line = notice;
		notice = undefined;
		return line;
	};

	/**
	 * The root every path here is resolved against.
	 *
	 * A tool registered by an extension receives the session's cwd, not the
	 * worktree the user entered: only the built-ins are re-rooted. The worktree
	 * extension publishes its root in the environment, so this is where the two
	 * meet, and it is applied before the repository lookup, the migration of an
	 * older store, and the plan path resolution.
	 */
	const baseOf = (cwd: string): string => resolveEffectiveCwd(cwd);

	const resolve = async (cwd: string): Promise<{ dir: string; root: string | undefined }> => {
		const base = baseOf(cwd);
		const cached = dirCache.get(base);
		if (cached) return cached;
		const repo = await repoKeyFor(pi, base);
		const dir = plansDir(getAgentDir(), repo.fromGit ? repo.key : undefined);
		dirCache.set(base, { dir, root: repo.fromGit ? repo.root : undefined });
		if (repo.fromGit) {
			// The keyed directory is the store; a store an older version left in the
			// checkout moves in once, so an upgrade does not strand its plans.
			const moved = migrateLegacyStore(dir, join(base, CONFIG_DIR_NAME, "plans"));
			if (moved > 0) notice = `Moved ${moved} plan${moved === 1 ? "" : "s"} to ${shortenPath(dir)}.`;
		}
		return { dir, root: repo.fromGit ? repo.root : undefined };
	};

	const dirFor = async (cwd: string): Promise<string> => (await resolve(cwd)).dir;

	const write = async (cwd: string, input: WritePlanInput): Promise<WrittenPlan> => {
		const base = baseOf(cwd);
		const title = input.title.trim();
		if (!title) throw new Error("A plan title is required.");
		const bytes = Buffer.byteLength(input.content, "utf-8");
		if (bytes > MAX_PLAN_BYTES) {
			throw new Error(`The plan is too large (${bytes} bytes; the limit is ${MAX_PLAN_BYTES}).`);
		}

		const dir = await dirFor(base);
		mkdirSync(dir, { recursive: true });

		let path: string;
		if (input.planPath) {
			const resolved = resolvePlanArg(dir, input.planPath);
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

		// A refinement rewrites the body but not the review: every stored comment is
		// carried onto the block whose text survived, so revising a plan under review
		// does not silently discard what a teammate wrote.
		const previous = existsSync(path) ? readFileSync(path, "utf-8") : undefined;
		const content = previous === undefined ? carryFeedback("", input.content) : carryFeedback(previous, input.content);
		const nextBytes = Buffer.byteLength(content, "utf-8");
		if (nextBytes > MAX_PLAN_BYTES) {
			throw new Error(`The plan is too large with its review comments (${nextBytes} bytes).`);
		}

		// Both are kept: the plan is what the review and the model read from now on, and the
		// revision is what they read before this call — the only thing a diff, or a comment
		// carried onto a block that moved, can be answered against.
		// A refinement that changed nothing has nothing to keep: the copy would be the plan.
		const replaced = previous === undefined || previous === content ? undefined : keepRevision(path, previous);
		writeAtomic(path, content);
		return {
			path,
			relativePath: shortenPath(path),
			title,
			content,
			bytes: nextBytes,
			...(replaced === undefined ? {} : { replaced: { path: replaced, relativePath: shortenPath(replaced) } }),
		};
	};

	const read = async (cwd: string, planPath: string): Promise<StoredPlan | undefined> => {
		const base = baseOf(cwd);
		const dir = await dirFor(base);
		const resolved = resolvePlanArg(dir, planPath);
		if (!isContainedPlan(dir, resolved) || !existsSync(resolved)) return undefined;
		try {
			const content = readFileSync(resolved, "utf-8");
			return {
				path: resolved,
				relativePath: shortenPath(resolved),
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
		// The expected text is the guard against a reordered plan: refuse the whole
		// batch rather than tick the step that moved into that number.
		const stale = updates.find((update) => {
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
	 * Write the browser review comments into an existing plan, replacing the
	 * comments of `options.author` (the owner when absent) and leaving every other
	 * writer's in place. The file must already be a contained plan, so this is the
	 * same path-safe write as `setSteps`.
	 */
	const saveFeedback = async (
		cwd: string,
		planPath: string,
		annotations: PlanAnnotation[],
		options: { author?: string } = {},
	): Promise<StoredPlan> => {
		const plan = await read(cwd, planPath);
		if (!plan) throw new Error("No plan file there; pass a plan_path written by write_plan.");
		const author = normalizeAuthor(options.author);
		// An untagged entry is the writer's own; one tagged with a different name is
		// another writer's comment, so it is dropped rather than re-signed.
		const own = annotations.filter((annotation) => {
			const who = normalizeAuthor(annotation.author);
			return who === "" || who === author;
		});
		const content = formatFeedback(plan.content, own, { author });
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
		const base = baseOf(cwd);
		const dir = await dirFor(base);
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
				relativePath: shortenPath(path),
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

	return { dirFor, write, read, latest, index, setSteps, saveFeedback, takeNotice };
}

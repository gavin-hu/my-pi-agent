/**
 * How long a plan store keeps what it holds (one job).
 *
 * A plan is a card's artifact and also a file that outlives its card, so the bound is a
 * decision rather than an expiry: **both bounds must agree before anything is removed** — a plan
 * older than `maxAgeDays` *and* outside the newest `keep` of its repository. A young plan is
 * kept however many there are, the newest hundred are kept however old they are, and a plan a
 * card on the board records is kept by neither bound at all.
 *
 * The decision is pure — the caller lists the directory and hands the entries with their
 * mtimes — so a suite pins every rule with three names and a clock instead of 38,000 files.
 * The two I/O doors beside it are the store's: read one directory, and remove what the decision
 * named.
 */

import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PlanConfig } from "./config.ts";
import { revisionBaseOf } from "./plan-files.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** One entry of a plan store, as the listing and the stat reported it. */
export interface PlanFile {
	name: string;
	mtimeMs: number;
}

/** What a pass is decided from. */
export interface RetentionInput {
	/** Every entry in one plan store. */
	entries: readonly PlanFile[];
	/** The plan names a card records, or `undefined` when the board could not be read. */
	protectedNames: ReadonlySet<string> | undefined;
	config: PlanConfig;
	/** The clock the age bound is measured against. */
	nowMs: number;
	/** Most file names one pass answers; absent means the whole store. */
	batch?: number;
}

/** Why a pass removed nothing at all. */
export type Decline = "disabled" | "unreadable-board";

/** What one pass decided. */
export interface RetentionAnswer {
	/** The file names to remove, each plan followed by its revisions, oldest plan first. */
	remove: string[];
	/** Plans this pass removes. */
	removedPlans: number;
	/** Plans a card records, and which are therefore never removed. */
	protected: number;
	/** Plans left in the store when this pass is done. */
	kept: number;
	/** Set when the pass declined and removed nothing. */
	declined?: Decline;
}

/** A plan is markdown and not a dotfile; the dotfiles are revisions and the legacy ignore file. */
function isPlan(name: string): boolean {
	return name.toLowerCase().endsWith(".md") && !name.startsWith(".");
}

/**
 * Decide what a pass removes.
 *
 * A revision follows its plan, because a chain whose base is gone belongs to nothing: a revision
 * is removed only in the same pass as its base, and then only as part of the same batch, so a
 * capped pass never leaves a plan's history behind alone.
 */
export function planRemovals(input: RetentionInput): RetentionAnswer {
	const plans = input.entries.filter((entry) => isPlan(entry.name));
	const answer = (declined: Decline): RetentionAnswer => ({
		remove: [],
		removedPlans: 0,
		protected: 0,
		kept: plans.length,
		declined,
	});
	if (!input.config.enabled) return answer("disabled");
	// A protection set that cannot be read is not an empty one: answering here is what keeps a
	// broken board read from becoming a deleted plan.
	if (input.protectedNames === undefined) return answer("unreadable-board");

	const protectedNames = input.protectedNames;
	// Newest first, so `keep` is a rank over plans and a revision never takes a slot.
	const newestFirst = [...plans].sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
	const oldestAllowedMs = input.nowMs - input.config.maxAgeDays * DAY_MS;
	const gone = new Set<string>();
	let protectedCount = 0;
	newestFirst.forEach((entry, rank) => {
		if (protectedNames.has(entry.name)) {
			protectedCount += 1;
			return;
		}
		if (entry.mtimeMs < oldestAllowedMs && rank >= input.config.keep) gone.add(entry.name);
	});

	// Oldest first, so a batched pass makes progress from the far end of the store.
	const bases = newestFirst.filter((entry) => gone.has(entry.name)).reverse();
	const groups = bases.map((entry) => [
		entry.name,
		...input.entries
			.filter((other) => revisionBaseOf(other.name) === entry.name)
			.map((other) => other.name)
			.sort(),
	]);
	const budget = input.batch ?? Number.POSITIVE_INFINITY;
	const remove: string[] = [];
	let removedPlans = 0;
	for (const group of groups) {
		if (remove.length + group.length > budget) break;
		remove.push(...group);
		removedPlans += 1;
	}
	return { remove, removedPlans, protected: protectedCount, kept: plans.length - removedPlans };
}

/** Every file in one plan store, with the mtime the age bound reads. A missing store is empty. */
export async function readPlanStore(dir: string): Promise<PlanFile[]> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
	if (entries === undefined) return [];
	const files: PlanFile[] = [];
	for (const entry of entries) {
		// A directory or a symlink is not a plan: the store refuses both as targets, so a sweep
		// neither follows one nor counts one.
		if (!entry.isFile()) continue;
		const info = await stat(join(dir, entry.name)).catch(() => undefined);
		if (info !== undefined) files.push({ name: entry.name, mtimeMs: info.mtimeMs });
	}
	return files;
}

/** What a sweep of one store did. */
export interface SweepResult extends RetentionAnswer {
	/** Bytes the removal freed, measured before the unlink. */
	bytes: number;
}

/** What a sweep is asked for: the same decision, plus whether to act on it. */
export interface SweepOptions extends Omit<RetentionInput, "entries"> {
	/** Decide and measure, and remove nothing. */
	dryRun?: boolean;
}

/**
 * Sweep one plan store: read it, decide, and remove what the decision names.
 *
 * `dryRun` stops before the unlink, so the report a person reads and the removal they then ask
 * for are the same decision rather than two.
 */
export async function sweepPlanStore(dir: string, options: SweepOptions): Promise<SweepResult> {
	const entries = await readPlanStore(dir);
	const answer = planRemovals({ ...options, entries });
	let bytes = 0;
	for (const name of answer.remove) {
		const info = await stat(join(dir, name)).catch(() => undefined);
		if (info === undefined) continue;
		bytes += info.size;
		if (options.dryRun !== true) await rm(join(dir, name), { force: true }).catch(() => undefined);
	}
	return { ...answer, bytes };
}

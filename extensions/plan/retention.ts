/**
 * How long a plan store keeps what it holds (one job).
 *
 * A plan is a card's artifact and also a file that outlives its card, so the bound is two
 * deletion triggers rather than one expiry: a plan is removed when it is **outside the newest
 * `keep` of its repository, or older than `maxAgeDays`** — either alone. `keep` is the protection
 * a normal store lives inside; `maxAgeDays` is the second trigger that catches a store which is
 * small and stale, where the count bound would never fire. The one real protection is the card
 * exemption: a plan any card on the board records is kept by neither trigger.
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
	/** What it takes on disk, from the same `stat` the mtime came from. */
	size: number;
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

/** One kind of file in a store that a sweep can never remove. */
export interface StoreArtefact {
	/** The extension, lowercased, or `none` for a file without one. */
	kind: string;
	count: number;
	bytes: number;
}

/** What one store holds, as the listing a sweep already read reported it. */
export interface StoreSummary {
	/** Plans a sweep can see: the only files it may remove. */
	plans: number;
	planBytes: number;
	/** Every file a sweep cannot see, grouped by kind, largest first. */
	artefacts: StoreArtefact[];
	/** Everything the store holds, plans and artefacts alike. */
	bytes: number;
}

/**
 * What a store holds, from the entries a pass already read.
 *
 * The filter is the *opposite* of {@link isPlan}'s: a dotfile is a revision of a plan, not an
 * artefact, so counting one would report a plan's history as something nobody can bound. Nothing
 * here decides anything — `planRemovals` owns that — so a store's size can never change what a
 * sweep removes.
 */
export function storeSummary(entries: readonly PlanFile[]): StoreSummary {
	let plans = 0;
	let planBytes = 0;
	const kinds = new Map<string, StoreArtefact>();
	let bytes = 0;
	for (const entry of entries) {
		bytes += entry.size;
		if (isPlan(entry.name)) {
			plans += 1;
			planBytes += entry.size;
			continue;
		}
		if (entry.name.startsWith(".")) continue;
		const kind = kindOf(entry.name);
		const found = kinds.get(kind);
		if (found === undefined) kinds.set(kind, { kind, count: 1, bytes: entry.size });
		else {
			found.count += 1;
			found.bytes += entry.size;
		}
	}
	// Largest first: the kind that made the store big is the one a reader needs to see.
	const artefacts = [...kinds.values()].sort((a, b) => b.bytes - a.bytes || a.kind.localeCompare(b.kind));
	return { plans, planBytes, artefacts, bytes };
}

/** The extension a file is known by, or `none`: the unit a report groups by. */
function kindOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot <= 0 || dot === name.length - 1 ? "none" : name.slice(dot + 1).toLowerCase();
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
		// Either trigger alone is enough: outside the count, or past the age.
		if (rank >= input.config.keep || entry.mtimeMs < oldestAllowedMs) gone.add(entry.name);
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
		if (info !== undefined) files.push({ name: entry.name, mtimeMs: info.mtimeMs, size: info.size });
	}
	return files;
}

/** What a sweep of one store did. */
export interface SweepResult extends RetentionAnswer {
	/** Bytes the removal freed, measured before the unlink. */
	bytes: number;
	/** What the store held when the sweep read it — the same entries the decision was made from. */
	summary: StoreSummary;
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
	const summary = storeSummary(entries);
	let bytes = 0;
	for (const name of answer.remove) {
		const info = await stat(join(dir, name)).catch(() => undefined);
		if (info === undefined) continue;
		bytes += info.size;
		if (options.dryRun !== true) await rm(join(dir, name), { force: true }).catch(() => undefined);
	}
	return { ...answer, bytes, summary };
}

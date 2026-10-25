/**
 * The managed-worktree registry and derived checkout status.
 *
 * Git is authoritative for whether a checkout exists; this registry only records
 * provenance (`createdByUs`, base, PR, timestamps) and usage (`lastUsedAt`). It
 * is a disposable cache: a missing or corrupt file loads as empty, writes are
 * best-effort, and reads reconcile against `git worktree list`.
 *
 * `statusOf` is the single derived view used by status, prune, and (later)
 * switch/exit, so those do not each re-derive dirty/ahead/behind/merged state.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { realPathOfNearest } from "../../lib/path.ts";
import type { WorktreeConfig } from "./config.ts";
import { commitsAhead, commitsBehind, isStaleLock, type ManagedWorktree, statusEntries } from "./git.ts";

const REGISTRY_VERSION = 1;

export interface WorktreeRecord {
	/** Canonical path; the record key. */
	path: string;
	name?: string;
	branch?: string;
	repoRoot: string;
	base: { ref: string; commit?: string; mode: "fresh" | "head" };
	/** Epoch ms. Zero means "unknown", for records synthesized from git. */
	createdAt: number;
	/** Epoch ms. Zero means "unknown". */
	lastUsedAt: number;
	pr?: { number: number; host: string };
	createdByUs: boolean;
}

export interface WorktreeRegistry {
	version: number;
	worktrees: WorktreeRecord[];
}

export interface CheckoutStatus {
	path: string;
	branch?: string;
	head?: string;
	state: "clean" | "dirty" | "missing";
	/** Number of changed files (porcelain entries). */
	changed: number;
	/**
	 * Commits the branch has made since the commit it was created at.
	 *
	 * Absent when that commit was never recorded — a worktree the user pointed us at —
	 * because git keeps no fork point of its own to ask.
	 */
	commits?: number;
	ahead: number;
	behind: number;
	/** Whether the work landed: every commit is in the base, and there were commits. */
	merged: boolean;
	locked: boolean;
	staleLock: boolean;
	lastUsedAt?: number;
}

export function registryPath(repoRoot: string, config: WorktreeConfig): string {
	return join(repoRoot, config.dir, "index.json");
}

function emptyRegistry(): WorktreeRegistry {
	return { version: REGISTRY_VERSION, worktrees: [] };
}

function isRecord(value: unknown): value is WorktreeRecord {
	if (!value || typeof value !== "object") return false;
	const record = value as Partial<WorktreeRecord>;
	return typeof record.path === "string" && typeof record.repoRoot === "string";
}

/** Read the registry. Missing, unreadable, or malformed files load as empty. */
export function loadRegistry(repoRoot: string, config: WorktreeConfig): WorktreeRegistry {
	try {
		const parsed = JSON.parse(readFileSync(registryPath(repoRoot, config), "utf-8")) as Partial<WorktreeRegistry>;
		if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.worktrees)) return emptyRegistry();
		return { version: REGISTRY_VERSION, worktrees: parsed.worktrees.filter(isRecord) };
	} catch {
		return emptyRegistry();
	}
}

/** Atomically persist the registry. Failures are swallowed: it is a cache. */
function saveRegistry(repoRoot: string, config: WorktreeConfig, registry: WorktreeRegistry): void {
	try {
		const file = registryPath(repoRoot, config);
		mkdirSync(dirname(file), { recursive: true });
		const tmp = `${file}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`);
		renameSync(tmp, file);
	} catch {
		// Losing the registry only loses provenance, never a worktree.
	}
}

/** Insert or replace a record, preserving an existing `createdAt`. */
export function upsertRecord(repoRoot: string, config: WorktreeConfig, record: WorktreeRecord): void {
	const registry = loadRegistry(repoRoot, config);
	const path = realPathOfNearest(record.path);
	const existing = registry.worktrees.find((candidate) => candidate.path === path);
	const next: WorktreeRecord = existing
		? { ...record, path, createdAt: existing.createdAt || record.createdAt }
		: { ...record, path };
	registry.worktrees = registry.worktrees.filter((candidate) => candidate.path !== path);
	registry.worktrees.push(next);
	registry.worktrees.sort((a, b) => a.path.localeCompare(b.path));
	saveRegistry(repoRoot, config, registry);
}

/** Mark a worktree as just used. No-op when it is not registered. */
export function touchRecord(repoRoot: string, config: WorktreeConfig, path: string, at = Date.now()): void {
	const registry = loadRegistry(repoRoot, config);
	const wanted = realPathOfNearest(path);
	const record = registry.worktrees.find((candidate) => candidate.path === wanted);
	if (!record) return;
	record.lastUsedAt = at;
	saveRegistry(repoRoot, config, registry);
}

export function removeRecord(repoRoot: string, config: WorktreeConfig, path: string): void {
	const registry = loadRegistry(repoRoot, config);
	const wanted = realPathOfNearest(path);
	const next = registry.worktrees.filter((candidate) => candidate.path !== wanted);
	if (next.length === registry.worktrees.length) return;
	registry.worktrees = next;
	saveRegistry(repoRoot, config, registry);
}

/**
 * Reconcile the registry against the worktrees git currently reports: drop
 * records whose checkout is gone, and synthesize records for managed worktrees
 * that have none. Persists only when something changed, and only when
 * `options.persist` is not `false` (the read-only status path passes `false`).
 */
export function reconcileRegistry(
	repoRoot: string,
	config: WorktreeConfig,
	managed: ManagedWorktree[],
	options: { persist?: boolean } = {},
): { registry: WorktreeRegistry; changed: boolean } {
	const registry = loadRegistry(repoRoot, config);
	// Resolve each entry once: the live set and the synthesized records both need it.
	const resolved = managed.map((entry) => ({ entry, path: realPathOfNearest(entry.path) }));
	const live = new Set(resolved.map((row) => row.path));
	const byPath = new Map(registry.worktrees.map((record) => [record.path, record] as const));

	let changed = false;
	const next: WorktreeRecord[] = [];
	for (const record of registry.worktrees) {
		if (live.has(record.path) || existsSync(record.path)) {
			next.push(record);
		} else {
			changed = true;
		}
	}
	for (const { entry, path } of resolved) {
		if (byPath.has(path)) continue;
		next.push({
			path,
			branch: entry.branch,
			repoRoot,
			base: { ref: "HEAD", mode: "head" },
			createdAt: 0,
			lastUsedAt: 0,
			createdByUs: false,
		});
		changed = true;
	}

	registry.worktrees = next.sort((a, b) => a.path.localeCompare(b.path));
	if (changed && options.persist !== false) saveRegistry(repoRoot, config, registry);
	return { registry, changed };
}

export interface StatusOptions {
	/** Ref to compare against (for example `origin/main`). Omit when unknown. */
	baseRef?: string;
	record?: WorktreeRecord;
}

/**
 * Derive one checkout's status from its git listing and registry record.
 *
 * `entry.path` is taken as canonical — the listing and `reconcileRegistry` are the
 * two places a path is resolved — so this does not walk the ancestors again.
 */
export async function statusOf(
	pi: ExtensionAPI,
	entry: ManagedWorktree,
	options: StatusOptions = {},
): Promise<CheckoutStatus> {
	const path = entry.path;
	const locked = entry.locked !== undefined;
	const staleLock = locked && entry.locked ? isStaleLock(entry.locked) : false;
	const base: CheckoutStatus = {
		path,
		branch: entry.branch,
		head: entry.head,
		state: "missing",
		changed: 0,
		ahead: 0,
		behind: 0,
		merged: false,
		locked,
		staleLock,
		lastUsedAt: options.record?.lastUsedAt,
	};

	if (!existsSync(path)) return base;

	const dirty = await statusEntries(pi, path);
	const baseRef = options.baseRef;
	base.state = dirty.length > 0 ? "dirty" : "clean";
	base.changed = dirty.length;
	// The commit the worktree was created at is the only fork point git can be asked about:
	// once a branch is merged, it and a branch that never committed are both ancestors of
	// the base, so `ahead` reports 0 for each and cannot tell them apart. This can.
	const since = options.record?.base.commit;
	if (since) base.commits = await commitsAhead(pi, path, since);
	if (baseRef) {
		base.ahead = await commitsAhead(pi, path, baseRef);
		base.behind = await commitsBehind(pi, path, baseRef);
		// `merged` claims the work landed, so it needs commits that could have landed: a
		// branch with none is an empty checkout, not a finished one.
		base.merged = base.ahead === 0 && base.commits !== 0;
	}
	return base;
}
